// domain-services/combat-power/public.ts
// Combat Power 純服務對外唯一入口：公開契約 + 兩個工廠 + 需注入的 Port 型別。
// Composition 只從這裡取用；不得深入 import 內部檔案，也不得從這裡取到 fixtures。
//
// 沒有 ModuleContract：本服務**沒有 State Slice、沒有 Handler、沒有 Job、沒有訂閱、不發事件**，
// 因此 owns / handles* / emits 全部無對應物。硬湊一份 ModuleContract 只會讓啟動驗證多一個假的
// Slice owner。它需要的東西是「注入的 Reader + Resolver + 四個世界事實 Port」，都在下面宣告。

// 公開契約（型別）——原樣轉出，讓消費者只從服務入口取用。
export type * from '../../contracts/combat-power';

// ── 純計算與唯讀 Facade 的工廠 ─────────────────────────────────────────────
export {
  createCombatPowerCalculator,
  createCombatPowerQuery,
  combatPowerDefinitionRevisionKey,
  CombatPowerRejection,
  CombatPowerRejectionCode,
} from './combat-power';

export type {
  CombatPowerCalculatorDeps,
  CombatPowerQueryDeps,
  CombatPowerRejectionCodeValue,
  CombatPowerRejectionDetails,
} from './combat-power';

// ── 需要整合者注入的 Port（§7.1 慣例：本地宣告型別，實作在 composition）─────────
export type {
  CombatPowerResolverPort,
  CombatPowerFeatureTransformResolverInput,
  CombatPowerCapabilityScalingResolverInput,
  CombatPowerUnitAggregationResolverInput,
  CombatPowerFormationResolverInput,
  CombatPowerExpectedSuccessResolverInput,
  CombatPowerStatisticsPort,
  CombatPowerLoadoutPort,
  CombatPowerWeaponSetConfigurationView,
  CombatPowerTeamPort,
  CombatPowerTeamMemberView,
  CombatPowerTeamCompositionView,
  CombatPowerEncounterPort,
  CombatPowerEncounterMemberView,
  CombatPowerEncounterCompositionView,
  CombatPowerQuestOppositionPort,
} from './combat-power';

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// 正式依賴圖不得走到測試資料（規範 §13，門禁 scripts/verify-runtime-discipline.ts）。
// 測試請直接 import './fixtures' 與 './combat-power.test'。
