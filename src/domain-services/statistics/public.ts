// domain-services/statistics/public.ts
// Statistics 純服務的對外唯一入口。無 State Slice、無 ModuleContract：這個服務不擁有 Slice、
// 不進交易、不註冊 Handler，因此 Composition 只需要工廠 + 它宣告的兩個注入面（Definition Reader
// 與 Resolver Port）。

// 公開契約（型別）——原樣轉出，讓消費者只從服務入口取用。
export type * from '../../contracts/statistics';

export {
  createCharacterStatisticsCalculator,
  StatisticsCalculationError,
  PRIMARY_ATTRIBUTE_IDS,
} from './statistics';

export type {
  StatisticsCalculatorDeps,
  StatisticsResolverPort,
  PrimaryAttributeDeltas,
  MasteryLevelView,
  AgeModifierResolverInput,
  ReputationContributionResolverInput,
  MasteryCoefficientResolverInput,
  FinalSecondaryResolverInput,
} from './statistics';

// ── Fixtures／Tests 不由 public.ts 對外 ───────────────────────────────────────
// public.ts 是服務的**正式對外面**。從這裡再匯出 fixtures 或 test runner，等於讓正式依賴圖
// 可以走到測試資料（規範 §13）。測試請直接 import './fixtures' 與 './statistics.test'。
