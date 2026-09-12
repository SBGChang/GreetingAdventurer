// app/content/map-context.ts
// `MapContentResolver` 與 `MapHandlerContext` 的正式組裝（docs/00_core/technical_architecture.md）。
//
// ── 為什麼是 Port 而不是 Resolver shape ────────────────────────────────────
//
// `MapSpawnRuleDefinition` **沒有 resolverId 欄位**，所以內容從來沒有宣告過「生成要用哪個
// Resolver」——它不是資料可綁的東西。生成候選的來源（文化池）與篩選條件（Tier／威脅）才是資料，
// 而那兩者都已經在 Definition 裡。所以這一層是組合層供給的 Port，與 `DungeonMapPort` 同性質。
//
// ── 挑選規則的來源 ────────────────────────────────────────────────────────
//
// 全部來自 `yunhua_content.md`，沒有一項是這裡發明的：
//   * §4／§7.2「地圖**不指定怪物種類偏好**」「不建立地圖專屬怪種 Pool」
//     → 候選來自文化池，不是逐圖名單。
//   * §7.4「非人類讀雲華全文化池；人類讀占領國文化池」
//     → 兩個池都是候選來源，合併後再篩。
//   * §7.4「地圖只限制 Tier、威脅、體型與槽位」
//     → 篩選條件恰好是 Tier 與威脅；Spawn Budget 的 contentKind 決定要哪一種威脅。
//
// **均勻抽取**是這裡唯一的演算法，而它不是被發明的平衡量：設計來源沒有給任何候選權重
//（§7.2 只說「任何合法的雲華非人類怪物都能配置」），所以「合法者機會均等」是唯一不加碼的讀法。
// 日後若設計補上權重，它會長在 `CultureContentCandidate` 上，這裡改讀那一欄即可。

import type {
  DefinitionId,
  MapInstanceId,
  RngContext,
  WorldDay,
} from '../../contracts/core';
import type { MonsterThreatRank } from '../../contracts/combat';
import type {
  CultureContentCandidate,
  MapContentDefinition,
  MapContentKind,
  MapDefinitionReader,
  MapSpawnRuleDefinition,
} from '../../contracts/map';
import type { DeterministicRng } from '../../contracts/core';
import type { DefinitionRegistry } from '../../data-runtime';
import type {
  MapContentResolver,
  MapHandlerContext,
  MapIdAllocator,
  SpawnDraft,
} from '../../modules/map/public';
import type { TeamPresenceQuery } from '../../contracts/map';
import { narrowedDomainReader } from './reader-adapter';
import { MAP_DEFINITION_KINDS } from './map-reader';

// Spawn Budget 的 contentKind → 這一槽可以接受哪些威脅等級。
//
// 「一般群」與「菁英」的 `contentKind` 都是 `monsterGroup`（`MapContentKind` 沒有 elite 這一值），
// 所以一個 monsterGroup 槽位可以是兩者之一——這正是 §7.4「2 一般群、1 菁英」在 Budget 裡只能
// 相加成 `monsterGroup ×3` 的原因（比例表達不出來，見 content-source/yunhua/maps.ts 的記載）。
// 非 Partial Record：新增一種 MapContentKind 卻忘了說它接受什麼威脅，就是編譯錯誤。
const ACCEPTED_THREATS: Readonly<Record<MapContentKind, readonly MonsterThreatRank[]>> = {
  monsterGroup: ['normal', 'elite'],
  boss: ['boss'],
  // 以下三種不是怪物內容，沒有威脅等級可篩；本版也沒有任何地圖為它們編列槽位
  // （九張圖的 spawnBudgets 都沒有 chest／mapEvent／kidnap／control），所以取不到候選就是
  // 明確失敗，不會靜默生出空內容。
  chest: [],
  mapEvent: [],
  kidnap: [],
  control: [],
};

export type MapContentResolverDeps = Readonly<{
  registry: DefinitionRegistry;
  definitions: MapDefinitionReader;
  rng: DeterministicRng;
}>;

export function createMapContentResolver(deps: MapContentResolverDeps): MapContentResolver {
  // 內容定義要能**依 (contentKind, threatRank) 反查**，而窄化 Reader 只提供 by-id。
  // 這張索引在建立時做一次；它是 Definition 的投影，不是新事實。
  const contentDefs = narrowedDomainReader<MapContentDefinition>(
    deps.registry,
    'reader:map.content-index',
    [MAP_DEFINITION_KINDS.content],
  ).list();

  const findContentDefinition = (
    kind: MapContentKind,
    threatRank: MonsterThreatRank,
  ): MapContentDefinition | undefined =>
    contentDefs.find((d) => d.contentKind === kind && d.threatRank === threatRank);

  const candidatesFor = (
    spawnRule: MapSpawnRuleDefinition,
    kind: MapContentKind,
  ): readonly CultureContentCandidate[] => {
    const accepted = ACCEPTED_THREATS[kind];
    if (accepted.length === 0) return [];
    // 兩個池都是候選來源（§7.4）。人類池在該地區被他國佔領時整池替換（§7.3），
    // 而「換成哪一池」是 Spawn Rule 的 `humanCultureContentRuleId` 指向哪裡——不是這裡決定的。
    const pools = [
      deps.definitions.getCultureContentRule(spawnRule.localCultureContentRuleId),
      deps.definitions.getCultureContentRule(spawnRule.humanCultureContentRuleId),
    ];
    return pools.flatMap((pool) =>
      pool.candidates.filter(
        (c) => c.tier <= spawnRule.contentTier && accepted.includes(c.threatRank),
      ),
    );
  };

  return {
    resolveSpawnPayload: (input): SpawnDraft => {
      const candidates = candidatesFor(input.spawnRule, input.kind);
      if (candidates.length === 0) {
        // 候選池是空的＝這一槽在目前內容下生不出東西。明確失敗，不得回一個空內容讓地圖
        // 看起來刷新成功（規範 §5「固定成功」與 P4 的陷阱都指名這一條）。
        throw new Error(
          `map-content-resolver：spawn rule "${String(input.spawnRule.id)}" 的 "${input.kind}" 槽位` +
            `在 Tier ≤ ${input.spawnRule.contentTier} 的文化池裡沒有任何候選——` +
            `候選池為空時必須明確失敗，不得生成空內容。`,
        );
      }

      // 均勻抽取（見檔頭：設計沒有給權重，所以合法者機會均等）。
      //
      // cursor 要**加上 `index`**：`generateMapContent` 對同一次刷新裡的每一格內容傳的是
      // **同一個 cursor**（`SpawnDraft` 沒有 nextCursor 欄位可以回傳串接後的游標），
      // 只用 cursor 的話一張圖的每一格都會抽到同一隻怪——實測正是如此。
      // `index`（＝本次刷新已生成的內容數）就是契約為了區分同批抽取而傳進來的欄位。
      const draw = deps.rng.nextInt({
        worldSeed: input.rng.worldSeed,
        streamId: input.rng.streamId,
        cursor: (input.rng.cursor + input.index) as typeof input.rng.cursor,
        minInclusive: 0,
        maxInclusive: candidates.length - 1,
      });
      const picked = candidates[draw.value]!;

      const definition = findContentDefinition(input.kind, picked.threatRank);
      if (definition === undefined) {
        throw new Error(
          `map-content-resolver：文化池挑到威脅 "${picked.threatRank}" 的候選，` +
            `但找不到 contentKind="${input.kind}" 且 threatRank="${picked.threatRank}" 的 map-content 定義。`,
        );
      }

      return {
        definitionId: definition.id as DefinitionId,
        payload: { kind: input.kind as 'monsterGroup' | 'boss', encounterGroupId: picked.encounterGroupId },
      };
    },
  };
}

// ── MapHandlerContext ───────────────────────────────────────────────────────

export type MapContextDeps = Readonly<{
  registry: DefinitionRegistry;
  definitions: MapDefinitionReader;
  world: MapHandlerContext['world'];
  presence: TeamPresenceQuery;
  ids: MapIdAllocator;
  rng: DeterministicRng;
  rngContext: RngContext;
  worldDay: WorldDay;
}>;

export function createMapContext(deps: MapContextDeps): MapHandlerContext {
  return {
    worldDay: deps.worldDay,
    definitions: deps.definitions,
    world: deps.world,
    presence: deps.presence,
    ids: deps.ids,
    rng: deps.rng,
    rngContext: deps.rngContext,
    resolvers: createMapContentResolver({
      registry: deps.registry,
      definitions: deps.definitions,
      rng: deps.rng,
    }),
  };
}

// 生成一張地圖本版本的動態內容（Bootstrap 與刷新共用）。
//
// 這是 `generateMapContent` 的組合層入口：map 模組擁有演算法（一房一內容、Budget 逐筆抽數量），
// 這裡只負責把它需要的 Context 組出來。
export type SpawnForInstanceDeps = MapContextDeps;

export { ACCEPTED_THREATS };
