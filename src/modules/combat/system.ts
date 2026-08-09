// modules/combat/system.ts
// Combat 純函式 Handler / Scheduler / Resolver 串接。
// 對應 docs/00_core/architecture/11_combat_module.md §5、§8、§9。
//
// 設計原則（對齊 batch-1 character/progression 模組）：
//   * 全部決定性純函式：不做 I/O、不呼叫 Math.random / Date.now。
//   * RNG 只經注入的 DeterministicRng + Encounter 私有 RngContext；成功推進後保存 nextCursor。
//   * 資料調校 kernel（傷害 / 治療 / CTB / 命中 / AI / Mastery 路由）藏在 CombatResolverPort 後；
//     Handler 只消費結果，不含公式（符合「Resolver design convention：data-tuned kernels」）。
//   * Handler 不 mutate 傳入 state；一律回傳新的 ModuleResult<CombatState>。
//
// 「真實」主路：StartCombatEncounter → 倒扣式 CTB 排程 → useCombatSkill（含 dealDamage/heal/
//   adjustCtb/applyStatus/removeStatus）→ 反擊 → 前排補位 → 全滅判定 → 一次性結算成長事件。
// 「stub // TODO」：戰鬥道具 workflow、commandAlly 一次性指令、Boss 重複中斷免疫細節、
//   跨武器組切換延遲、interruptCasting 的多段技能保留。

import type {
  EncounterId,
  CombatantId,
  CharacterId,
  RuntimeEnemyId,
  MonsterDefinitionId,
  MasteryId,
  WeaponSetId,
  SkillDefinitionId,
  CombatEffectDefinitionId,
  CombatStatusInstanceId,
  ResolverId,
  TeamId,
  Revision,
  ModuleId,
  ModuleResult,
  TransactionMessageDraft,
  DeterministicRng,
} from '../../contracts/core';
import type {
  CombatDefinitionReader,
  CombatEncounterSource,
  CombatSkillDefinitionView,
  CombatActionKind,
  CombatEffectDefinition,
  CombatStatusInstance,
  CombatFootprint,
  StartCombatEncounterCommand,
  UseCombatSkillCommand,
  UseCombatItemCommand,
  CommandAllyCommand,
  CombatRestCommand,
  CombatEncounterOutcome,
  CombatDomainEvent,
  CombatActionResult,
  CombatOutboundInternalCommand,
} from '../../contracts/combat';
import type { PrimaryAttributeId } from '../../contracts/progression';
import type { ProgressionQuery } from '../../contracts/progression';
import type { CharacterEquipmentLoadoutView } from '../../contracts/inventory';
import type { ApplyCombatCondition } from '../../contracts/character';
import type { GridCell } from '../../contracts/map';

import type {
  CombatState,
  CombatEncounter,
  CombatantState,
  CombatGridState,
  CounterStanceInstance,
  DefenseFormationEntry,
} from './state';
import { bumpRevision, rebuildGrid, tryGetEncounter, upsertEncounter } from './state';

// ──────────────────────────────────────────────────────────────────────────
// 模組常數 / 目標模組
// ──────────────────────────────────────────────────────────────────────────

export const COMBAT_MODULE_ID = 'combat' as ModuleId;
const CHARACTER_MODULE = 'character' as ModuleId;
const INVENTORY_MODULE = 'inventory' as ModuleId;
const MAP_MODULE = 'map' as ModuleId;

const SUPPORT_USE_CAP = 3; // §3.2 / §8.6：同角色同支援技能每場最多記 3 次。
const PRIMARY_ATTRIBUTE_IDS: readonly PrimaryAttributeId[] = [
  'muscle',
  'intelligence',
  'reaction',
  'coordination',
  'charisma',
];

// ──────────────────────────────────────────────────────────────────────────
// 注入 Port（讓 Handler 保持純函式；真實由 Composition 注入，測試注入決定性 stub）
// ──────────────────────────────────────────────────────────────────────────

// 交易私有 ID 配發器（背後由 Kernel RuntimeIdGenerator + cursor 提供）。
export interface CombatIdAllocator {
  nextEncounterId(): EncounterId;
  nextCombatantId(): CombatantId;
  nextRuntimeEnemyId(): RuntimeEnemyId;
  nextStatusInstanceId(): CombatStatusInstanceId;
}

// Inventory Loadout Query（窄化：只需目前武器組配置）。
export interface CombatLoadoutQuery {
  getEquipmentLoadout(characterId: CharacterId): CharacterEquipmentLoadoutView;
}

// 開戰隊伍站位快照來源（Team/Formation 擁有；Combat 開場讀一次）。
export type CombatFormationMember = Readonly<{
  characterId: CharacterId;
  cell: GridCell; // 局部座標：row 1 = 前排
  activeWeaponSetId: WeaponSetId;
  maxHealth: number;
  maxMana: number;
  startHealth: number; // 進戰當下 HP 快照（Character 擁有真相）
  startMana: number;
}>;
export type CombatFormationSnapshot = Readonly<{
  teamId: TeamId;
  formationRevision: Revision;
  members: readonly CombatFormationMember[]; // 正式成員 1..9
}>;
export interface CombatFormationQuery {
  getPlayerFormation(teamId: TeamId): CombatFormationSnapshot;
}

// 資料調校 kernel（= 文件的 Combat Power / Damage / Heal / CTB / Hit Resolver 家族）。
export type CombatPowerInput = Readonly<{
  resolverId: ResolverId;
  encounter: CombatEncounter;
  actorId: CombatantId;
  targetId?: CombatantId;
}>;
export type EnemyActionChoice = Readonly<{
  skillId: SkillDefinitionId;
  targetCombatantIds: readonly CombatantId[];
}>;
export interface CombatResolverPort {
  // 傷害 / 治療 / CTB 調整 / 命中的實際數值（回傳實數；adjustCtb 可為負）。
  resolvePower(input: CombatPowerInput): number;
  // 攻擊 MXP 路由：該次技能有效傷害計入哪個 Mastery。
  resolveAttackMastery(skillId: SkillDefinitionId): MasteryId;
  // 防禦 MXP 路由：該角色開戰防具對應的 Mastery。
  resolveDefenseMastery(characterId: CharacterId): MasteryId;
  // 敵方 AI（data-driven policy）：選招 + 目標；undefined = 無合法行動 → 視為休息。
  chooseEnemyAction(input: Readonly<{ encounter: CombatEncounter; actorId: CombatantId }>):
    | EnemyActionChoice
    | undefined;
  // 反擊條件是否成立（攻擊種類 / 格擋等；資料化）。
  evaluateCounterStance(
    input: Readonly<{
      encounter: CombatEncounter;
      defenderId: CombatantId;
      attackerId: CombatantId;
      incomingActionKind: CombatActionKind;
    }>,
  ): boolean;
}

export type CombatHandlerContext = Readonly<{
  definitions: CombatDefinitionReader;
  progression: ProgressionQuery;
  loadout: CombatLoadoutQuery;
  formation: CombatFormationQuery;
  resolvers: CombatResolverPort;
  ids: CombatIdAllocator;
  rng: DeterministicRng;
}>;

// ──────────────────────────────────────────────────────────────────────────
// ModuleResult / 事件工具
// ──────────────────────────────────────────────────────────────────────────

function emit(event: CombatDomainEvent): TransactionMessageDraft {
  return { event };
}
// B.5：外送命令以接收模組契約的真實型別為參數（見 contracts/combat CombatOutboundInternalCommand）。
function command(
  targetModule: ModuleId,
  cmd: CombatOutboundInternalCommand,
): TransactionMessageDraft {
  return { targetModule, command: cmd };
}
function result(
  state: CombatState,
  messages: readonly TransactionMessageDraft[] = [],
): ModuleResult<CombatState> {
  return { nextSlice: state, outgoingMessages: messages, scheduledJobs: [] };
}

// ──────────────────────────────────────────────────────────────────────────
// 純工具：屬性 / footprint / 格
// ──────────────────────────────────────────────────────────────────────────

type Attributes = Record<PrimaryAttributeId, number>;

function attributesOf(combatant: CombatantState, ctx: CombatHandlerContext): Attributes {
  if (combatant.source.kind === 'character') {
    return ctx.progression.getPrimaryAttributes(combatant.source.characterId);
  }
  const def = ctx.definitions.getMonster(combatant.source.monsterDefinitionId);
  return {
    muscle: def.attributes.muscle,
    intelligence: def.attributes.intelligence,
    reaction: def.attributes.reaction,
    coordination: def.attributes.coordination,
    charisma: def.attributes.charisma,
  };
}

function footprintForSize(size: 'small' | 'medium' | 'large'): CombatFootprint {
  switch (size) {
    case 'large':
      return { width: 3, height: 3 };
    case 'medium':
      return { width: 2, height: 2 };
    default:
      return { width: 1, height: 1 };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// §8.2 前排全空自動補位（整側同步前移；保留欄位與相對排距）
// ──────────────────────────────────────────────────────────────────────────

function backfillSide(
  combatants: Record<CombatantId, CombatantState>,
  side: 'player' | 'enemy',
): void {
  const alive = (Object.keys(combatants) as CombatantId[])
    .map((id) => combatants[id])
    .filter((c): c is CombatantState => c !== undefined && c.side === side && c.state !== 'dead');
  if (alive.length === 0) return;

  const occupiedRows = new Set<number>();
  for (const c of alive) {
    for (let r = 0; r < c.footprint.height; r += 1) occupiedRows.add(c.anchorCell.row + r);
  }
  // 第 1 排仍有占格單位 → 整側不動（§8.2.3）。
  if (occupiedRows.has(1)) return;
  const frontMost = Math.min(...occupiedRows);
  const shift = frontMost - 1;
  if (shift <= 0) return;

  for (const c of alive) {
    combatants[c.combatantId] = {
      ...c,
      anchorCell: { ...c.anchorCell, row: c.anchorCell.row - shift },
      revision: bumpRevision(c.revision),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// §8.1 倒扣式 CTB 排程
// ──────────────────────────────────────────────────────────────────────────

function ctbReduction(
  reductions: readonly Readonly<{ primaryAttribute: PrimaryAttributeId; reductionPerPoint: number }>[],
  attrs: Attributes,
): number {
  let sum = 0;
  for (const r of reductions) sum += (attrs[r.primaryAttribute] ?? 0) * r.reductionPerPoint;
  return sum;
}

function schedulable(encounter: CombatEncounter): CombatantState[] {
  return (Object.keys(encounter.combatants) as CombatantId[])
    .map((id) => encounter.combatants[id])
    .filter((c): c is CombatantState => c !== undefined && c.state === 'ready');
}

// 玩家側優先；同側同值以 Encounter 決定性 RNG 排序（不變量 12）。回傳新 cursor。
function orderReadyBatch(
  ids: readonly CombatantId[],
  encounter: CombatEncounter,
  ctx: CombatHandlerContext,
): Readonly<{ ordered: CombatantId[]; nextCursor: number }> {
  const players = ids.filter((id) => encounter.combatants[id]?.side === 'player');
  const enemies = ids.filter((id) => encounter.combatants[id]?.side === 'enemy');
  const rc = encounter.rngContext;
  let cursor = rc.cursor as unknown as number;

  const shuffle = (arr: CombatantId[]): CombatantId[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const step = ctx.rng.nextInt({
        worldSeed: rc.worldSeed,
        streamId: rc.streamId,
        cursor: cursor as never,
        minInclusive: 0,
        maxInclusive: i,
      });
      cursor = step.nextCursor as unknown as number;
      const j = step.value;
      const tmp = a[i]!;
      a[i] = a[j]!;
      a[j] = tmp;
    }
    return a;
  };

  const ordered = [...shuffle(players), ...shuffle(enemies)];
  return { ordered, nextCursor: cursor };
}

// 一次全體倒扣：以最小非負 currentCtb 扣除；抵 0 者依序進 readyQueue。
// 反覆倒扣直到有人可行動或無人可排。回傳更新後的 Encounter（含 readyQueue、rngContext.cursor）。
function subtractDownRefill(
  encounter: CombatEncounter,
  ctx: CombatHandlerContext,
): CombatEncounter {
  let current = encounter;
  // 防呆上限：避免資料異常導致無限迴圈。
  for (let guard = 0; guard < 1000; guard += 1) {
    const sched = schedulable(current);
    if (sched.length === 0) return { ...current, readyQueue: [] };

    const min = Math.min(...sched.map((c) => c.currentCtb));
    const combatants: Record<CombatantId, CombatantState> = { ...current.combatants };
    for (const c of sched) {
      combatants[c.combatantId] = { ...c, currentCtb: c.currentCtb - min };
    }
    const atZero = sched
      .map((c) => c.combatantId)
      .filter((id) => (combatants[id]?.currentCtb ?? 1) === 0);

    const withCombatants: CombatEncounter = { ...current, combatants };
    if (atZero.length > 0) {
      const { ordered, nextCursor } = orderReadyBatch(atZero, withCombatants, ctx);
      return {
        ...withCombatants,
        readyQueue: ordered,
        rngContext: { ...withCombatants.rngContext, cursor: nextCursor as never },
      };
    }
    current = withCombatants; // min 為 0 但無人抵 0（理論上不會）→ 再跑一輪
  }
  return { ...current, readyQueue: [] };
}

// 取下一個行動者：先清掉頭部無效項；空則倒扣補位。設定 currentActorId 與 Encounter phase。
// 導出供排程單元測試直接驗證倒扣式 CTB 順序。
export function advanceToNextActor(
  encounter: CombatEncounter,
  ctx: CombatHandlerContext,
): CombatEncounter {
  // readyQueue 只保留「仍存活且 currentCtb 恰為 0」者；行動後 ctb>0 的行動者自然被移出。
  let queue = encounter.readyQueue.filter((id) => {
    const c = encounter.combatants[id];
    return c !== undefined && c.state === 'ready' && c.currentCtb === 0;
  });
  let current: CombatEncounter = { ...encounter, readyQueue: queue };
  if (queue.length === 0) {
    current = subtractDownRefill(current, ctx);
    queue = [...current.readyQueue];
  }
  const head = queue[0];
  if (head === undefined) {
    return { ...current, currentActorId: undefined, state: 'active' };
  }
  const actor = current.combatants[head];
  const phase = actor?.side === 'player' ? 'awaitingPlayerCommand' : 'active';
  return { ...current, currentActorId: head, readyQueue: queue, state: phase };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.1 StartCombatEncounter（真實主路）
// ──────────────────────────────────────────────────────────────────────────

function buildPlayerCombatants(
  formation: CombatFormationSnapshot,
  ctx: CombatHandlerContext,
): Record<CombatantId, CombatantState> {
  const out: Record<CombatantId, CombatantState> = {};
  for (const member of formation.members) {
    const id = ctx.ids.nextCombatantId();
    out[id] = {
      combatantId: id,
      source: { kind: 'character', characterId: member.characterId },
      side: 'player',
      footprint: { width: 1, height: 1 },
      anchorCell: member.cell,
      health: member.startHealth,
      maxHealth: member.maxHealth,
      mana: member.startMana,
      maxMana: member.maxMana,
      currentCtb: 0,
      externalCtbIncreaseSinceOwnAction: 0,
      interruptionImmuneUntilOwnAction: false,
      activeWeaponSetId: member.activeWeaponSetId,
      activeStatuses: [],
      state: 'ready',
      revision: 0 as Revision,
    };
  }
  return out;
}

function buildEnemyCombatants(
  source: CombatEncounterSource,
  ctx: CombatHandlerContext,
): Record<CombatantId, CombatantState> {
  const group = ctx.definitions.getEncounterGroup(source.encounterGroupId);
  const out: Record<CombatantId, CombatantState> = {};
  for (const placement of group.initialPlacements) {
    const monster = ctx.definitions.getMonster(placement.monsterDefinitionId);
    const id = ctx.ids.nextCombatantId();
    out[id] = {
      combatantId: id,
      source: {
        kind: 'monster',
        monsterDefinitionId: placement.monsterDefinitionId,
        runtimeEnemyId: ctx.ids.nextRuntimeEnemyId(),
      },
      side: 'enemy',
      footprint: footprintForSize(monster.bodySize),
      anchorCell: placement.anchorCell,
      health: monster.attributes.health,
      maxHealth: monster.attributes.health,
      mana: 0,
      maxMana: 0, // 怪物不使用 MP 資源池（結算不對怪物寫回 Character 條件）。
      currentCtb: 0,
      externalCtbIncreaseSinceOwnAction: 0,
      interruptionImmuneUntilOwnAction: false,
      activeStatuses: [],
      state: 'ready',
      revision: 0 as Revision,
    };
  }
  return out;
}

function applyOpeningCtb(
  combatants: Record<CombatantId, CombatantState>,
  source: CombatEncounterSource,
  ctx: CombatHandlerContext,
): void {
  // 同一場所有單位使用同一 opening baseCtb；差異只來自主屬扣減（文件 §2.7）。
  const group = ctx.definitions.getEncounterGroup(source.encounterGroupId);
  void group;
  // combatRule 綁定於 EncounterGroup 之外；此處第一版以固定 CombatRuleId 由 reader 提供。
  const rule = ctx.definitions.getCombatRule(COMBAT_RULE_ID);
  const opening = ctx.definitions.getOpeningCtbRule(rule.openingCtbRuleId);
  for (const id of Object.keys(combatants) as CombatantId[]) {
    const c = combatants[id]!;
    const attrs = attributesOf(c, ctx);
    const ctb = Math.max(opening.minimumCtb, opening.baseCtb - ctbReduction(opening.reductions, attrs));
    combatants[id] = { ...c, currentCtb: ctb };
  }
}

// 第一版固定 CombatRule 入口（Composition 會以來源 world/map 綁定；此處以常數對接 reader）。
const COMBAT_RULE_ID = 'combat-rule-standard' as Parameters<CombatDefinitionReader['getCombatRule']>[0];

export function handleStartCombatEncounter(
  state: CombatState,
  cmd: StartCombatEncounterCommand,
  ctx: CombatHandlerContext,
): ModuleResult<CombatState> {
  const formation = ctx.formation.getPlayerFormation(cmd.teamId);

  // §5.1 驗證：正式成員 1..9，且恰配置每人一次。
  const count = formation.members.length;
  if (count < 1 || count > 9) {
    // TODO: 以 CommandRejection 回報漏配 / 第十名 / 額外候補；第一版拒絕即為 no-op。
    return result(state);
  }

  const playerCombatants = buildPlayerCombatants(formation, ctx);
  const enemyCombatants = buildEnemyCombatants(cmd.source, ctx);
  const combatants: Record<CombatantId, CombatantState> = {
    ...playerCombatants,
    ...enemyCombatants,
  };

  // 開場前排補位（§8.2.1：建立完配置立即判定一次）。
  backfillSide(combatants, 'player');
  backfillSide(combatants, 'enemy');

  // 開場 CTB。
  applyOpeningCtb(combatants, cmd.source, ctx);

  // 防禦權重快照（開戰初始站位；補位不改本快照）。
  const defenseFormationRows: DefenseFormationEntry[] = [];
  const participantCharacterIds: CharacterId[] = [];
  for (const id of Object.keys(playerCombatants) as CombatantId[]) {
    const c = combatants[id]!;
    if (c.source.kind !== 'character') continue;
    participantCharacterIds.push(c.source.characterId);
    defenseFormationRows.push({ characterId: c.source.characterId, row: c.anchorCell.row });
  }

  const encounterId = ctx.ids.nextEncounterId();
  let encounter: CombatEncounter = {
    encounterId,
    source: cmd.source,
    playerTeamId: cmd.teamId,
    playerFormationRevision: formation.formationRevision,
    combatants,
    playerGrid: rebuildGrid(combatants, 'player'),
    enemyGrid: rebuildGrid(combatants, 'enemy'),
    state: 'initializing',
    readyQueue: [],
    supportMasteryUseCounts: {},
    rngContext: cmd.rngContext,
    revision: 0 as Revision,
    participantCharacterIds,
    defenseFormationRows,
    attackDamageByCharacter: {},
  };

  // 首次倒扣 → 決定開場行動者。
  encounter = advanceToNextActor(encounter, ctx);

  const messages: TransactionMessageDraft[] = [
    emit({
      type: 'CombatEncounterStarted',
      encounterId,
      teamId: cmd.teamId,
      source: cmd.source,
    }),
  ];
  return result(upsertEncounter(state, encounter), messages);
}

// ──────────────────────────────────────────────────────────────────────────
// 效果套用（§2.5 完整六種 operation）
// ──────────────────────────────────────────────────────────────────────────

type Working = Readonly<{
  encounter: CombatEncounter;
  combatants: Record<CombatantId, CombatantState>;
  results: CombatActionResult[];
}>;

function getC(work: Working, id: CombatantId): CombatantState {
  const c = work.combatants[id];
  if (c === undefined) throw new Error(`missing combatant ${String(id)}`);
  return c;
}

function isEnemyMonster(c: CombatantState): boolean {
  return c.source.kind === 'monster';
}

// 對 Monster 的外來正值 adjustCtb 套控制抗性 + 兩次自身行動間累積上限（§2.6）。
// TODO: CombatDefinitionReader 未提供 getControlResistanceProfile；補上 getter 後才能以
//   ctbIncreaseMultiplier 折算並套 maxExternalCtbIncreaseBeforeOwnAction 上限。
//   第一版主路以 multiplier=1、無累積上限處理（負值調整本就不吃抗性）。
function resistedCtbIncrease(target: CombatantState, raw: number, _ctx: CombatHandlerContext): number {
  if (!isEnemyMonster(target) || raw <= 0) return raw;
  return raw;
}

function applyEffect(
  work: Working,
  effect: CombatEffectDefinition,
  actorId: CombatantId,
  skillId: SkillDefinitionId,
  targetIds: readonly CombatantId[],
  ctx: CombatHandlerContext,
): Working {
  const combatants = work.combatants;
  const results = work.results;
  const op = effect.operation;

  switch (op.kind) {
    case 'dealDamage': {
      const rule = ctx.definitions.getDamageRule(op.damageRuleId);
      for (const targetId of targetIds) {
        const target = combatants[targetId];
        if (target === undefined || target.state === 'dead') continue;
        const amount = Math.max(
          0,
          Math.round(
            ctx.resolvers.resolvePower({
              resolverId: rule.powerResolverId,
              encounter: work.encounter,
              actorId,
              targetId,
            }),
          ),
        );
        const nextHealth = target.health - amount;
        const dead = nextHealth <= 0;
        combatants[targetId] = {
          ...target,
          health: dead ? 0 : nextHealth,
          state: dead ? 'dead' : target.state,
          revision: bumpRevision(target.revision),
        };
        results.push({ kind: 'dealDamage', targetId: String(targetId), amount, dead });

        // 攻擊 MXP 帳本：只累計角色行動者對各 Mastery 的有效傷害。
        const actor = combatants[actorId];
        if (actor !== undefined && actor.source.kind === 'character' && amount > 0) {
          recordAttackDamage(work, actor.source.characterId, ctx.resolvers.resolveAttackMastery(skillId), amount);
        }
      }
      return { ...work, combatants, results };
    }
    case 'heal': {
      const rule = ctx.definitions.getHealRule(op.healRuleId);
      for (const targetId of targetIds) {
        const target = combatants[targetId];
        if (target === undefined || target.state === 'dead') continue;
        const amount = Math.max(
          0,
          Math.round(
            ctx.resolvers.resolvePower({
              resolverId: rule.powerResolverId,
              encounter: work.encounter,
              actorId,
              targetId,
            }),
          ),
        );
        const nextHealth = Math.min(target.maxHealth, target.health + amount);
        combatants[targetId] = {
          ...target,
          health: nextHealth,
          revision: bumpRevision(target.revision),
        };
        results.push({ kind: 'heal', targetId: String(targetId), amount });
      }
      return { ...work, combatants, results };
    }
    case 'adjustCtb': {
      const rule = ctx.definitions.getCtbAdjustmentRule(op.adjustmentRuleId);
      for (const targetId of targetIds) {
        const target = combatants[targetId];
        if (target === undefined || target.state === 'dead') continue;
        const raw = Math.round(
          ctx.resolvers.resolvePower({
            resolverId: rule.amountResolverId,
            encounter: work.encounter,
            actorId,
            targetId,
          }),
        );
        const applied = resistedCtbIncrease(target, raw, ctx);
        const nextCtb = Math.max(0, target.currentCtb + applied); // 最低夾 0；上限不 clamp
        combatants[targetId] = {
          ...target,
          currentCtb: nextCtb,
          externalCtbIncreaseSinceOwnAction:
            applied > 0
              ? target.externalCtbIncreaseSinceOwnAction + applied
              : target.externalCtbIncreaseSinceOwnAction,
          revision: bumpRevision(target.revision),
        };
        results.push({ kind: 'adjustCtb', targetId: String(targetId), amount: applied });
      }
      return { ...work, combatants, results };
    }
    case 'interruptCasting': {
      const rule = ctx.definitions.getCombatInterruptionRule(op.interruptionRuleId);
      for (const targetId of targetIds) {
        const target = combatants[targetId];
        if (target === undefined || target.state === 'dead' || target.casting === undefined) continue;
        if (!rule.appliesToActionKinds.includes(target.casting.actionKind)) continue;
        // TODO: Boss 若本次自身行動前已成功被中斷 → 後續 interruptCasting 只保留其他效果。
        const delayRule = ctx.definitions.getActionDelayRule(rule.interruptionDelayRuleId);
        const attrs = attributesOf(target, ctx);
        const delay = Math.max(
          delayRule.minimumDelay,
          delayRule.baseDelay - ctbReduction(delayRule.reductions, attrs),
        );
        combatants[targetId] = {
          ...target,
          casting: undefined,
          currentCtb: target.currentCtb + delay,
          revision: bumpRevision(target.revision),
        };
        results.push({ kind: 'interruptCasting', targetId: String(targetId) });
      }
      return { ...work, combatants, results };
    }
    case 'applyStatus': {
      for (const targetId of targetIds) {
        const target = combatants[targetId];
        if (target === undefined || target.state === 'dead') continue;
        const instance: CombatStatusInstance = {
          statusInstanceId: ctx.ids.nextStatusInstanceId(),
          statusId: op.statusId,
          remainingTargetActions: op.durationTargetActions,
          appliedByCombatantId: actorId,
          revision: 0 as Revision,
        };
        const activeStatuses = mergeStatus(target.activeStatuses, instance, op.stackPolicy);
        combatants[targetId] = { ...target, activeStatuses, revision: bumpRevision(target.revision) };
        results.push({ kind: 'applyStatus', targetId: String(targetId), statusId: String(op.statusId) });
      }
      return { ...work, combatants, results };
    }
    case 'removeStatus': {
      for (const targetId of targetIds) {
        const target = combatants[targetId];
        if (target === undefined || target.state === 'dead') continue;
        const activeStatuses = target.activeStatuses.filter((s) => s.statusId !== op.statusId);
        combatants[targetId] = { ...target, activeStatuses, revision: bumpRevision(target.revision) };
        results.push({ kind: 'removeStatus', targetId: String(targetId), statusId: String(op.statusId) });
      }
      return { ...work, combatants, results };
    }
    default:
      return work;
  }
}

function mergeStatus(
  statuses: readonly CombatStatusInstance[],
  incoming: CombatStatusInstance,
  policy: 'replace' | 'refresh' | 'strongest',
): CombatStatusInstance[] {
  const idx = statuses.findIndex((s) => s.statusId === incoming.statusId);
  if (idx < 0) return [...statuses, incoming];
  const next = [...statuses];
  const existing = next[idx]!;
  switch (policy) {
    case 'replace':
      next[idx] = incoming;
      break;
    case 'refresh':
      next[idx] = { ...existing, remainingTargetActions: incoming.remainingTargetActions };
      break;
    case 'strongest':
      next[idx] =
        incoming.remainingTargetActions > existing.remainingTargetActions ? incoming : existing;
      break;
  }
  return next;
}

function recordAttackDamage(
  work: Working,
  characterId: CharacterId,
  masteryId: MasteryId,
  amount: number,
): void {
  const ledger = { ...work.encounter.attackDamageByCharacter };
  const perChar = { ...(ledger[characterId] ?? {}) };
  perChar[masteryId] = (perChar[masteryId] ?? 0) + amount;
  ledger[characterId] = perChar;
  // work.encounter 是 Readonly，這裡以就地重建（Working 於呼叫端整體重組）。
  (work as { encounter: CombatEncounter }).encounter = {
    ...work.encounter,
    attackDamageByCharacter: ledger,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// §8.4 反擊解析
// ──────────────────────────────────────────────────────────────────────────

// 攻擊命中後，對「被命中且持有反擊架勢」的防守者檢查條件並解析一次反擊。
function resolveCounters(
  work: Working,
  attackerId: CombatantId,
  incomingKind: CombatActionKind,
  hitTargetIds: readonly CombatantId[],
  ctx: CombatHandlerContext,
): Working {
  if (incomingKind !== 'attack') return work;
  let current = work;
  for (const defenderId of hitTargetIds) {
    const defender = current.combatants[defenderId];
    if (defender === undefined || defender.state === 'dead' || defender.counterStance === undefined) {
      continue;
    }
    const stance = defender.counterStance;
    const ok = ctx.resolvers.evaluateCounterStance({
      encounter: current.encounter,
      defenderId,
      attackerId,
      incomingActionKind: incomingKind,
    });
    if (!ok) continue;

    // 解析反擊效果（回打攻擊者），套反擊延遲，解除架勢。
    for (const effectId of stance.counterEffectIds) {
      const effect = ctx.definitions.getCombatEffect(effectId);
      current = applyEffect(current, effect, defenderId, stance.skillId, [attackerId], ctx);
    }
    const counterDelayRule = ctx.definitions.getActionDelayRule(stance.counterDelayRuleId);
    const d = current.combatants[defenderId];
    if (d !== undefined) {
      const attrs = attributesOf(d, ctx);
      const delay = Math.max(
        counterDelayRule.minimumDelay,
        counterDelayRule.baseDelay - ctbReduction(counterDelayRule.reductions, attrs),
      );
      current.combatants[defenderId] = {
        ...d,
        counterStance: undefined,
        currentCtb: d.currentCtb + delay,
        revision: bumpRevision(d.revision),
      };
    }
    current.results.push({ kind: 'counter', defenderId: String(defenderId), attackerId: String(attackerId) });
  }
  return current;
}

// ──────────────────────────────────────────────────────────────────────────
// 動作延遲 + 狀態倒扣 + 收尾（補位、全滅判定、下一位）
// ──────────────────────────────────────────────────────────────────────────

function actionDelayFor(
  actor: CombatantState,
  skillView: CombatSkillDefinitionView,
  ctx: CombatHandlerContext,
): number {
  const rule = ctx.definitions.getActionDelayRule(skillView.actionDelayRuleId);
  const attrs = attributesOf(actor, ctx);
  return Math.max(rule.minimumDelay, rule.baseDelay - ctbReduction(rule.reductions, attrs));
}

// 對行動者「後續完成的行動」倒扣狀態剩餘次數（§2.5）；到 0 移除。
function decrementActorStatuses(actor: CombatantState): CombatantState {
  if (actor.activeStatuses.length === 0) return actor;
  const next = actor.activeStatuses
    .map((s) => ({ ...s, remainingTargetActions: s.remainingTargetActions - 1 }))
    .filter((s) => s.remainingTargetActions > 0);
  return { ...actor, activeStatuses: next };
}

function sideAllDead(encounter: CombatEncounter, side: 'player' | 'enemy'): boolean {
  const members = (Object.keys(encounter.combatants) as CombatantId[])
    .map((id) => encounter.combatants[id])
    .filter((c): c is CombatantState => c !== undefined && c.side === side);
  return members.length > 0 && members.every((c) => c.state === 'dead');
}

// 收尾：套 Working 回 encounter → 補位 → 全滅判定（結算）或推進到下一位。
function finishTurn(
  state: CombatState,
  work: Working,
  actorId: CombatantId,
  ctx: CombatHandlerContext,
  actionMessages: readonly TransactionMessageDraft[],
): ModuleResult<CombatState> {
  const combatants = work.combatants;

  // §8.2.2：一個完整 Action 與其反應鏈解析完後再判定一次補位。
  backfillSide(combatants, 'player');
  backfillSide(combatants, 'enemy');

  let encounter: CombatEncounter = {
    ...work.encounter,
    combatants,
    playerGrid: rebuildGrid(combatants, 'player'),
    enemyGrid: rebuildGrid(combatants, 'enemy'),
    revision: bumpRevision(work.encounter.revision),
  };

  const messages: TransactionMessageDraft[] = [...actionMessages];

  const enemyWiped = sideAllDead(encounter, 'enemy');
  const playerWiped = sideAllDead(encounter, 'player');
  if (enemyWiped || playerWiped) {
    const outcome: CombatEncounterOutcome = enemyWiped ? 'victory' : 'defeat';
    return resolveEncounter(state, encounter, outcome, ctx, messages);
  }

  encounter = advanceToNextActor(encounter, ctx);
  void actorId;
  return result(upsertEncounter(state, encounter), messages);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 useCombatSkill（真實主路）
// ──────────────────────────────────────────────────────────────────────────

export function handleUseCombatSkill(
  state: CombatState,
  cmd: UseCombatSkillCommand,
  ctx: CombatHandlerContext,
): ModuleResult<CombatState> {
  const encounter = tryGetEncounter(state, cmd.encounterId);
  if (encounter === undefined || encounter.state === 'resolved') return result(state);
  // 前置：Encounter 等待該行動者（不變量 4：非法輸入不進 Resolver）。
  if (encounter.currentActorId !== cmd.actorId) return result(state);
  const actor0 = encounter.combatants[cmd.actorId];
  if (actor0 === undefined || actor0.state === 'dead') return result(state);

  const skillView = ctx.definitions.getSkillView(cmd.skillId);

  // 起始 Working（就地可變 combatants 副本）。
  let combatants: Record<CombatantId, CombatantState> = { ...encounter.combatants };
  let work: Working = { encounter, combatants, results: [] };

  // 付資源成本。
  const actor = getC(work, cmd.actorId);
  let health = actor.health;
  let mana = actor.mana;
  for (const cost of skillView.resourceCosts) {
    if (cost.resource === 'health') health = Math.max(0, health - cost.amount);
    else mana = Math.max(0, mana - cost.amount);
  }
  // 切換武器組（同組不切裝；跨組先套切換延遲 — 第一版只更新 activeWeaponSetId）。
  // TODO: 跨武器組切換延遲需先加 switchDelayRule 再執行技能。
  const activeWeaponSetId = cmd.weaponSetId ?? actor.activeWeaponSetId;
  combatants[cmd.actorId] = { ...actor, health, mana, activeWeaponSetId };
  work = { ...work, combatants };

  // 守勢 / 反擊：建立架勢消耗本次行動，不立即套用效果（§8.4）。
  if (skillView.counterStance !== undefined) {
    const stance: CounterStanceInstance = {
      skillId: cmd.skillId,
      conditionResolverId: skillView.counterStance.conditionResolverId,
      counterDelayRuleId: skillView.counterStance.counterDelayRuleId,
      counterEffectIds: skillView.effectIds,
    };
    const a = getC(work, cmd.actorId);
    work.combatants[cmd.actorId] = { ...a, counterStance: stance };
    work.results.push({ kind: 'counterStanceEstablished', actorId: String(cmd.actorId) });
  } else {
    // 套用技能所有效果到合法目標。
    for (const effectId of skillView.effectIds) {
      const effect = ctx.definitions.getCombatEffect(effectId);
      work = applyEffect(work, effect, cmd.actorId, cmd.skillId, cmd.targetCombatantIds, ctx);
    }
    // 反擊反應鏈（攻擊命中持架勢者）。
    work = resolveCounters(work, cmd.actorId, skillView.actionKind, cmd.targetCombatantIds, ctx);
  }

  // 記錄無傷害支援技能成功使用次數（§8.6；每角色每技能上限 3）。
  const supportCounts = tallySupportUse(work.encounter, cmd.actorId, cmd.skillId, skillView, work);

  // 行動延遲 + 狀態倒扣 + 自身行動旗標重置。
  const acted0 = getC(work, cmd.actorId);
  const delay = actionDelayFor(acted0, skillView, ctx);
  const acted = decrementActorStatuses({
    ...acted0,
    currentCtb: acted0.currentCtb + delay,
    externalCtbIncreaseSinceOwnAction: 0,
    interruptionImmuneUntilOwnAction: false,
    revision: bumpRevision(acted0.revision),
  });
  work.combatants[cmd.actorId] = acted;
  work = { ...work, encounter: { ...work.encounter, supportMasteryUseCounts: supportCounts } };

  const actionEvent = emit({
    type: 'CombatActionResolved',
    encounterId: cmd.encounterId,
    actorId: cmd.actorId,
    skillId: cmd.skillId,
    results: work.results,
  });

  return finishTurn(state, work, cmd.actorId, ctx, [actionEvent]);
}

function tallySupportUse(
  encounter: CombatEncounter,
  actorId: CombatantId,
  skillId: SkillDefinitionId,
  skillView: CombatSkillDefinitionView,
  work: Working,
): CombatEncounter['supportMasteryUseCounts'] {
  const actor = work.combatants[actorId] ?? encounter.combatants[actorId];
  if (
    actor === undefined ||
    actor.source.kind !== 'character' ||
    skillView.masteryExperienceMode !== 'fixedSupport'
  ) {
    return encounter.supportMasteryUseCounts;
  }
  const characterId = actor.source.characterId;
  const perChar = { ...(encounter.supportMasteryUseCounts[characterId] ?? {}) };
  const prev = perChar[skillId] ?? 0;
  perChar[skillId] = Math.min(SUPPORT_USE_CAP, prev + 1);
  return { ...encounter.supportMasteryUseCounts, [characterId]: perChar };
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 敵方 AI 回合（data-driven policy）
// ──────────────────────────────────────────────────────────────────────────

export function handleEnemyTurn(
  state: CombatState,
  encounterId: EncounterId,
  ctx: CombatHandlerContext,
): ModuleResult<CombatState> {
  const encounter = tryGetEncounter(state, encounterId);
  if (encounter === undefined || encounter.state === 'resolved') return result(state);
  const actorId = encounter.currentActorId;
  if (actorId === undefined) return result(state);
  const actor = encounter.combatants[actorId];
  if (actor === undefined || actor.side !== 'enemy' || actor.state === 'dead') return result(state);

  const choice = ctx.resolvers.chooseEnemyAction({ encounter, actorId });
  if (choice === undefined) {
    // 無合法行動：以固定小延遲讓出行動（近似 combatRest 的休止）。
    const combatants = { ...encounter.combatants };
    combatants[actorId] = { ...actor, currentCtb: actor.currentCtb + 100, revision: bumpRevision(actor.revision) };
    const work: Working = { encounter: { ...encounter, combatants }, combatants, results: [] };
    return finishTurn(state, work, actorId, ctx, []);
  }
  // 敵方選招同樣走 useCombatSkill 主路（保證效果 / 延遲 / 補位 / 結算一致）。
  return handleUseCombatSkill(
    state,
    {
      type: 'useCombatSkill',
      encounterId,
      actorId,
      skillId: choice.skillId,
      targetCombatantIds: choice.targetCombatantIds,
    },
    ctx,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 combatRest（真實主路：回復少量並增加延遲）
// ──────────────────────────────────────────────────────────────────────────

export function handleCombatRest(
  state: CombatState,
  cmd: CombatRestCommand,
  ctx: CombatHandlerContext,
): ModuleResult<CombatState> {
  const encounter = tryGetEncounter(state, cmd.encounterId);
  if (encounter === undefined || encounter.state === 'resolved') return result(state);
  if (encounter.currentActorId !== cmd.actorId) return result(state);
  const actor = encounter.combatants[cmd.actorId];
  if (actor === undefined || actor.state === 'dead') return result(state);

  const rule = ctx.definitions.getCombatRule(COMBAT_RULE_ID);
  const delayRule = ctx.definitions.getActionDelayRule(rule.combatRestDelayRuleId);
  const attrs = attributesOf(actor, ctx);
  const delay = Math.max(delayRule.minimumDelay, delayRule.baseDelay - ctbReduction(delayRule.reductions, attrs));

  // 回復少量 HP/MP（第一版固定小額；資料化細節待接）。
  const RESTORE = 5;
  const combatants = { ...encounter.combatants };
  const acted = decrementActorStatuses({
    ...actor,
    health: Math.min(actor.maxHealth, actor.health + RESTORE),
    mana: actor.mana + RESTORE,
    currentCtb: actor.currentCtb + delay,
    externalCtbIncreaseSinceOwnAction: 0,
    revision: bumpRevision(actor.revision),
  });
  combatants[cmd.actorId] = acted;
  const work: Working = {
    encounter: { ...encounter, combatants },
    combatants,
    results: [{ kind: 'rest', actorId: String(cmd.actorId) }],
  };
  const actionEvent = emit({
    type: 'CombatActionResolved',
    encounterId: cmd.encounterId,
    actorId: cmd.actorId,
    results: work.results,
  });
  return finishTurn(state, work, cmd.actorId, ctx, [actionEvent]);
}

// ──────────────────────────────────────────────────────────────────────────
// §5.2 useCombatItem / commandAlly（stub // TODO）
// ──────────────────────────────────────────────────────────────────────────

export function handleUseCombatItem(
  state: CombatState,
  cmd: UseCombatItemCommand,
  _ctx: CombatHandlerContext,
): ModuleResult<CombatState> {
  const encounter = tryGetEncounter(state, cmd.encounterId);
  if (encounter === undefined || encounter.state === 'resolved') return result(state);
  if (encounter.currentActorId !== cmd.actorId) return result(state);
  // inventory 契約的 CommitCombatItemUse 只吃 { itemId, userId }：userId 是使用者的
  // CharacterId，不是 CombatantId。怪物沒有背包，非角色行動者直接視為非法。
  const actor = encounter.combatants[cmd.actorId];
  if (actor === undefined || actor.source.kind !== 'character') return result(state);
  // TODO: 完整戰鬥道具 workflow —— 待 CombatItemUseCommitted 回來後才套效果 / 延遲。
  //   第一版僅發出提交草案，不改 Encounter 快照。
  return result(state, [
    command(INVENTORY_MODULE, {
      type: 'CommitCombatItemUse',
      itemId: cmd.itemInstanceId,
      userId: actor.source.characterId,
    }),
  ]);
}

export function handleCommandAlly(
  state: CombatState,
  cmd: CommandAllyCommand,
  _ctx: CombatHandlerContext,
): ModuleResult<CombatState> {
  const encounter = tryGetEncounter(state, cmd.encounterId);
  if (encounter === undefined || encounter.state === 'resolved') return result(state);
  // TODO: 寫入一次性 AI 指令（隊友仍以自己的行動時機執行）。第一版為 no-op。
  return result(state);
}

// ──────────────────────────────────────────────────────────────────────────
// §9 Encounter 結束（真實主路；一次性成長事件與寫回草案）
// ──────────────────────────────────────────────────────────────────────────

function resolveEncounter(
  state: CombatState,
  encounter0: CombatEncounter,
  outcome: CombatEncounterOutcome,
  ctx: CombatHandlerContext,
  priorMessages: readonly TransactionMessageDraft[],
): ModuleResult<CombatState> {
  if (encounter0.state === 'resolved') return result(state); // 冪等：只結算一次

  const encounter: CombatEncounter = { ...encounter0, state: 'resolved', currentActorId: undefined, readyQueue: [] };
  const messages: TransactionMessageDraft[] = [...priorMessages];

  const source = encounter.source;
  const encounterId = encounter.encounterId;

  // (1) ApplyCombatCondition：對每名角色寫回 HP/MP 變化（相對開戰快照 delta）。
  for (const id of Object.keys(encounter.combatants) as CombatantId[]) {
    const c = encounter.combatants[id]!;
    if (c.source.kind !== 'character') continue;
    const applyCmd: ApplyCombatCondition = {
      type: 'ApplyCombatCondition',
      characterId: c.source.characterId,
      healthDelta: c.health - c.maxHealth,
      manaDelta: c.mana - c.maxMana,
    };
    messages.push(command(CHARACTER_MODULE, applyCmd));
  }

  // (2) 地圖內容處理：由 dungeon 訂閱 CombatEncounterResolved 後發出 ResolvePlayerMapContent。
  // 該命令必填 distributionId，屬於 Dungeon Session，combat 無從取得（見 dungeon
  // handleCombatEncounterResolved 的說明）。combat 只負責發出已發生事實。

  // (3) 成長事件（只在正式 resolved 時發，一次）。
  const budgets = encounterBudgets(encounter, ctx);
  const attackAwards = computeAttackAwards(encounter, budgets.attack);
  if (attackAwards.length > 0) {
    messages.push(
      emit({
        type: 'CombatAttackMasteryEarned',
        source: { kind: 'encounter', encounterId },
        characterAwards: attackAwards,
      }),
    );
  }
  const defenseAwards = computeDefenseAwards(encounter, budgets.defense, ctx);
  if (defenseAwards.length > 0) {
    messages.push(
      emit({
        type: 'CombatDefenseMasteryEarned',
        source: { kind: 'encounter', encounterId },
        characterAwards: defenseAwards,
      }),
    );
  }
  for (const support of computeSupportAwards(encounter, ctx)) {
    messages.push(emit({ type: 'CombatSupportMasteryEarned', ...support }));
  }

  // (4) CombatEncounterResolved + CombatTeamOutcome。
  messages.push(
    emit({
      type: 'CombatEncounterResolved',
      encounterId,
      teamId: encounter.playerTeamId,
      participantCharacterIds: encounter.participantCharacterIds,
      source,
      outcome,
    }),
    emit({
      type: 'CombatTeamOutcome',
      teamId: encounter.playerTeamId,
      canContinue: outcome === 'victory',
      reason: outcome === 'victory' ? 'encounterVictory' : 'teamWiped',
    }),
  );

  return result(upsertEncounter(state, encounter), messages);
}

type Budgets = Readonly<{ attack: number; defense: number }>;

function encounterBudgets(encounter: CombatEncounter, ctx: CombatHandlerContext): Budgets {
  const group = ctx.definitions.getEncounterGroup(encounter.source.encounterGroupId);
  const budget = ctx.definitions.getExperienceBudget(group.experienceBudgetId);
  let attack = 0;
  let defense = 0;
  for (const monsterId of group.memberDefinitionIds) {
    const monster = ctx.definitions.getMonster(monsterId);
    const profile = ctx.definitions.getMonsterExperienceProfile(monster.experienceProfileId);
    attack += profile.attackExperience;
    defense += profile.defenseExperience;
  }
  return { attack: attack * budget.groupModifier, defense: defense * budget.groupModifier };
}

type Award = Readonly<{ characterId: CharacterId; masteryId: MasteryId; amount: number }>;

// 攻擊 MXP：依角色對各敵人造成的有效傷害比例分配（§8.6）。
function computeAttackAwards(encounter: CombatEncounter, budget: number): Award[] {
  let total = 0;
  for (const characterId of Object.keys(encounter.attackDamageByCharacter) as CharacterId[]) {
    const perMastery = encounter.attackDamageByCharacter[characterId] ?? {};
    for (const masteryId of Object.keys(perMastery) as MasteryId[]) total += perMastery[masteryId] ?? 0;
  }
  if (total <= 0 || budget <= 0) return [];
  const awards: Award[] = [];
  for (const characterId of Object.keys(encounter.attackDamageByCharacter) as CharacterId[]) {
    const perMastery = encounter.attackDamageByCharacter[characterId] ?? {};
    for (const masteryId of Object.keys(perMastery) as MasteryId[]) {
      const dmg = perMastery[masteryId] ?? 0;
      if (dmg <= 0) continue;
      awards.push({ characterId, masteryId, amount: (dmg / total) * budget });
    }
  }
  return awards;
}

// 防禦 MXP：開戰初始站位由前至後略過空排，第一/二/三個有人排權重 3/2/1（§8.6）。
function computeDefenseAwards(
  encounter: CombatEncounter,
  budget: number,
  ctx: CombatHandlerContext,
): Award[] {
  if (budget <= 0 || encounter.defenseFormationRows.length === 0) return [];
  const occupiedRows = [...new Set(encounter.defenseFormationRows.map((e) => e.row))].sort((a, b) => a - b);
  const weightOfRow = new Map<number, number>();
  const weights = [3, 2, 1];
  occupiedRows.forEach((row, i) => weightOfRow.set(row, weights[i] ?? 0));

  const perChar = new Map<CharacterId, number>();
  let totalWeight = 0;
  for (const entry of encounter.defenseFormationRows) {
    const w = weightOfRow.get(entry.row) ?? 0;
    perChar.set(entry.characterId, (perChar.get(entry.characterId) ?? 0) + w);
    totalWeight += w;
  }
  if (totalWeight <= 0) return [];
  const awards: Award[] = [];
  for (const [characterId, w] of perChar) {
    if (w <= 0) continue;
    awards.push({
      characterId,
      masteryId: ctx.resolvers.resolveDefenseMastery(characterId),
      amount: (w / totalWeight) * budget,
    });
  }
  return awards;
}

type SupportAwardEvent = Readonly<{
  source: { kind: 'encounter'; encounterId: EncounterId };
  characterId: CharacterId;
  skillId: SkillDefinitionId;
  supportMasteryAwardRuleId: NonNullable<CombatSkillDefinitionView['supportMasteryAwardRuleId']>;
  creditedUseCount: number;
}>;

// 支援 MXP：本場成功使用次數（每角色每技能上限 3）於 resolved 一次發放。
function computeSupportAwards(
  encounter: CombatEncounter,
  ctx: CombatHandlerContext,
): SupportAwardEvent[] {
  const out: SupportAwardEvent[] = [];
  for (const characterId of Object.keys(encounter.supportMasteryUseCounts) as CharacterId[]) {
    const perSkill = encounter.supportMasteryUseCounts[characterId] ?? {};
    for (const skillId of Object.keys(perSkill) as SkillDefinitionId[]) {
      const count = perSkill[skillId] ?? 0;
      if (count <= 0) continue;
      const skillView = ctx.definitions.getSkillView(skillId);
      if (skillView.supportMasteryAwardRuleId === undefined) continue;
      out.push({
        source: { kind: 'encounter', encounterId: encounter.encounterId },
        characterId,
        skillId,
        supportMasteryAwardRuleId: skillView.supportMasteryAwardRuleId,
        creditedUseCount: count,
      });
    }
  }
  return out;
}
