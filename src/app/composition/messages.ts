// app/composition/messages.ts
// 全遊戲訊息聯集（對應 00_shared_contracts.md §5：具體聯集屬 app/composition，不在 core 定義）。
//
// core 的 TransactionMessageDraft 以 unknown 承載 payload，因此**路由只能靠 payload 自帶的
// `type` 判別欄**（規範見 contracts/core/messages.ts）。此處把已實作模組的訊息收成三個聯集，
// 並提供型別安全的判別與 router 查表基礎。
//
// 未實作模組（economy/city/quest/social/crafting/distribution/world/npc-behavior）的訊息
// 於其 Wave 併入下列聯集即可，不需改動 kernel。

import type { ModuleId } from '../../contracts/core';

import type { CharacterInternalCommand, CharacterDomainEvent } from '../../contracts/character';
import type {
  InventoryGameCommand,
  InventoryInternalCommand,
  InventoryDomainEvent,
} from '../../contracts/inventory';
import type { ProgressionDomainEvent } from '../../contracts/progression';
import type { MapInternalCommand, MapDomainEvent } from '../../contracts/map';
import type { DungeonGameCommand, DungeonDomainEvent } from '../../contracts/dungeon';
import type {
  CombatGameCommand,
  CombatInternalCommand,
  CombatDomainEvent,
} from '../../contracts/combat';
import type {
  TeamGameCommand,
  TeamInboundInternalCommand,
  TeamDomainEvent,
} from '../../contracts/team';

// ──────────────────────────────────────────────────────────────────────────
// 三種訊息的全遊戲聯集
// ──────────────────────────────────────────────────────────────────────────

// Progression 目前沒有任何已實作的 Game Command（learnFromBook / startTeaching 的 Handler 未撰寫），
// 因此不在此 union——沒有能力就不該有註冊表面。
// Progression 與 Dungeon 目前沒有任何已註冊的 Game Command：
//   progression —— learnFromBook / startTeaching 的 Handler 未撰寫。
//   dungeon     —— 只註冊四筆已實作且只送有 Owner 命令者，見 contracts/dungeon 說明。
export type GameCommand =
  | InventoryGameCommand
  | DungeonGameCommand
  | CombatGameCommand
  | TeamGameCommand;

export type GameInternalCommand =
  | CharacterInternalCommand
  | InventoryInternalCommand
  | MapInternalCommand
  | CombatInternalCommand
  | TeamInboundInternalCommand;

export type GameDomainEvent =
  | CharacterDomainEvent
  | InventoryDomainEvent
  | ProgressionDomainEvent
  | MapDomainEvent
  | DungeonDomainEvent
  | CombatDomainEvent
  | TeamDomainEvent;

export type GameCommandType = GameCommand['type'];
export type GameInternalCommandType = GameInternalCommand['type'];
export type GameDomainEventType = GameDomainEvent['type'];

// ──────────────────────────────────────────────────────────────────────────
// 判別工具
// ──────────────────────────────────────────────────────────────────────────

// kernel 交給 router 的 payload 是 unknown；先確認它至少帶得起判別欄再查表。
export function messageTypeOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const t = (payload as { type?: unknown }).type;
  return typeof t === 'string' ? t : undefined;
}

// 路由失敗一律是註冊錯誤（12_engine_runtime.md §5.1：每筆 Internal Command 恰好一個 Handler），
// 不得靜默丟棄——靜默丟棄會讓「命令送出但什麼都沒發生」變成看不見的 bug。
export function requireMessageType(payload: unknown, context: string): string {
  const t = messageTypeOf(payload);
  if (t === undefined) {
    throw new Error(
      `${context}: 訊息缺少 \`type\` 判別欄，無法路由（見 contracts/core/messages.ts 的判別欄約定）`,
    );
  }
  return t;
}

// ──────────────────────────────────────────────────────────────────────────
// Internal Command → 唯一 Handler 模組（12_engine_runtime.md §5.1）
//
// 這是「誰處理什麼」的唯一真相。Bootstrap 會用它交叉驗證各模組 ModuleContract 宣告的
// handlesInternalCommands，任一缺漏／重複／不一致都在啟動時失敗。
// ──────────────────────────────────────────────────────────────────────────

export const INTERNAL_COMMAND_OWNER: Readonly<Record<GameInternalCommandType, ModuleId>> = {
  // character
  CreateQuestTemporaryCharacter: 'character' as ModuleId,
  CreateWorldAdventurerBatch: 'character' as ModuleId,
  ApplyCharacterReputationEffect: 'character' as ModuleId,
  CreatePartnerFamilyLink: 'character' as ModuleId,
  ApplyContentEventStatus: 'character' as ModuleId,
  OpenCharacterRelationshipFact: 'character' as ModuleId,
  ResolveCharacterRelationshipFact: 'character' as ModuleId,
  ApplyCombatCondition: 'character' as ModuleId,
  ApplyFoodStatusEffects: 'character' as ModuleId,

  // inventory
  CreateItemInstance: 'inventory' as ModuleId,
  RemoveItemInstance: 'inventory' as ModuleId,
  TransferItem: 'inventory' as ModuleId,
  ReserveQuestItem: 'inventory' as ModuleId,
  ReserveCraftingInputs: 'inventory' as ModuleId,
  MoveItemToTeamQuestCargo: 'inventory' as ModuleId,
  CommitCombatItemUse: 'inventory' as ModuleId,
  EvaluateTeamEncumbrance: 'inventory' as ModuleId,

  // map
  SetMapRefreshLock: 'map' as ModuleId,
  ProtectMapContent: 'map' as ModuleId,
  ResolvePlayerMapContent: 'map' as ModuleId,
  ApplyNpcDungeonSettlement: 'map' as ModuleId,
  OpenMapDoor: 'map' as ModuleId,
  ResolveMapTrap: 'map' as ModuleId,
  HarvestMapGatheringNode: 'map' as ModuleId,

  // dungeon

  // combat
  StartCombatEncounter: 'combat' as ModuleId,

  // team
  StartReturnFromDungeon: 'team' as ModuleId,
  StartNpcTeamPlan: 'team' as ModuleId,
  CompletePlayerTravelSegmentWithoutEvent: 'team' as ModuleId,
};

// §5.1：每個 Game Command 必須恰好有一個入口接收者——領域 Module Handler **或**
// WorkflowDefinition.startsFrom，兩者不可同時註冊。下面兩張表合起來必須覆蓋全部
// GameCommandType（由 registry 的啟動驗證檢查），任一缺漏或重複都是註冊錯誤。
//
// 用 Record<GameCommandType, ...>（非 Partial）宣告，讓**編譯器**保證覆蓋完整：
// 新增一個 Game Command 卻忘了指定入口，tsc 就會擋下。
export const WORKFLOW_ENTRY = 'workflow' as const;
export type GameCommandEntry = ModuleId | typeof WORKFLOW_ENTRY;

export const GAME_COMMAND_ENTRY: Readonly<Record<GameCommandType, GameCommandEntry>> = {
  // dungeon（僅四筆；入場／離場／採集與 NPC 流程皆未註冊，見 contracts/dungeon）
  moveDungeonRoom: 'dungeon' as ModuleId,
  openDungeonDoor: 'dungeon' as ModuleId,
  interactDungeonContent: 'dungeon' as ModuleId,
  resolveDungeonInteraction: 'dungeon' as ModuleId,

  // inventory
  equipItem: 'inventory' as ModuleId,
  // 入口為 Workflow：05_inventory_module.md §1.2 —— selectedSkillIds 的合法性（Definition 存在、
  // 角色已學會、啟動手可用）要跨 Progression 與 Combat 內容判定，Inventory 不得同步查別的模組。
  // 由 weapon-set-configuration Workflow 驗證後才交給 Inventory Handler 寫入。
  configureWeaponSet: WORKFLOW_ENTRY,

  // progression

  // dungeon

  // combat
  useCombatSkill: 'combat' as ModuleId,
  combatRest: 'combat' as ModuleId,

  // team
  startCityTravel: 'team' as ModuleId,
  enterAdventureMap: 'team' as ModuleId,
  returnToCity: 'team' as ModuleId,
  beginCityFreePeriod: 'team' as ModuleId,
  rest: 'team' as ModuleId,
  selectPlayerSuccessor: 'team' as ModuleId,
  recruitTavernAdventurer: 'team' as ModuleId,
  configureCombatFormation: 'team' as ModuleId,
};

// 由模組 Handler 直接接收的 Game Command（Workflow 入口不在此表）。
export const GAME_COMMAND_OWNER: Readonly<Partial<Record<GameCommandType, ModuleId>>> =
  Object.fromEntries(
    Object.entries(GAME_COMMAND_ENTRY).filter(([, entry]) => entry !== WORKFLOW_ENTRY),
  ) as Readonly<Partial<Record<GameCommandType, ModuleId>>>;

// 入口為 Workflow 的 Command（Workflow 本身待其 Wave 實作）。
export const WORKFLOW_ENTRY_COMMANDS: readonly GameCommandType[] = Object.entries(
  GAME_COMMAND_ENTRY,
)
  .filter(([, entry]) => entry === WORKFLOW_ENTRY)
  .map(([type]) => type as GameCommandType);
