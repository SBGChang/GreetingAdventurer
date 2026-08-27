// app/content/team-resolvers.ts
// team 模組的 Resolver shape → 實作建構子表（目前：預設戰鬥站位）。
//
// 與 combat-resolvers.ts 同構：Resolver ID 從 binding 帶入（資料），本檔只認 shape 代碼鍵。
// team 的擲骰型 Resolver（招募/離隊）走 kernel-logistic 家族、需要曲線 params——那是「第一版方案
// （待討論）」的數值，另行增量處理；本檔先放**不需發明任何平衡量**的純演算法：預設站位。

import { GRID_MAX, GRID_MIN } from '../../contracts/core';
import type { CharacterId, ResolverBinding, SchemaId, TeamId } from '../../contracts/core';
import type { GridCell } from '../../contracts/map';
import type { AnyResolverRegistration, ResolverRegistration } from '../../data-runtime';

// resolveDefaultPlacement 的輸入/輸出（結構性重宣告，避免 import team/system.ts 的大依賴面）。
export type DefaultPlacementInput = Readonly<{
  teamId: TeamId;
  memberIds: readonly CharacterId[];
  current: Readonly<Record<CharacterId, GridCell>>;
}>;
export type DefaultPlacement = Readonly<Record<CharacterId, GridCell>>;

const PLACEMENT_INPUT_SCHEMA = 'schema:team-default-placement-input' as SchemaId;
const PLACEMENT_RESULT_SCHEMA = 'schema:team-placement' as SchemaId;

// 九宮格寬度與格數由結構不變量導出（GRID_MIN/GRID_MAX，見 contracts/core/invariants.ts），
// 不是可調平衡量——所以用名稱而非字面 3／9。
const GRID_WIDTH = GRID_MAX - GRID_MIN + 1;
const GRID_CELLS = GRID_WIDTH * GRID_WIDTH;

// 第一版預設站位方案（待討論）：忽略 current，依 memberIds 順序 row-major 逐格填滿九宮格
//（row/col 以 GRID_MIN 為基準，與 team 既有慣例 cellRowMajor/makeFormation 完全一致）。
// 02_team_module.md §3.1 要求「合法且不重疊」——依索引指派天然不重疊。正式成員 > 9 違反結構
// 不變量（隊伍上限 9），明確拋錯而非溢出到格外。
//
// 待討論：目前不讀 current（每次重算全排），也未依角色定位（前排肉盾/後排輸出）排序——那需要
// 角色定位資料與設計決策；第一版先給決定性、可玩、不重疊的排法。
function defaultPlacement(input: DefaultPlacementInput): DefaultPlacement {
  if (input.memberIds.length > GRID_CELLS) {
    throw new Error(
      `team-default-placement：正式成員 ${input.memberIds.length} 超過九宮格 ${GRID_CELLS} 格（隊伍上限被破壞）`,
    );
  }
  const out: Record<CharacterId, GridCell> = {};
  input.memberIds.forEach((id, i) => {
    out[id] = {
      floor: 0,
      row: GRID_MIN + Math.floor(i / GRID_WIDTH),
      col: GRID_MIN + (i % GRID_WIDTH),
    };
  });
  return out;
}

function placementRegistration(
  binding: ResolverBinding,
): ResolverRegistration<DefaultPlacementInput, DefaultPlacement> {
  return {
    resolverId: binding.resolverId,
    ownerModule: binding.ownerModule,
    inputSchemaId: PLACEMENT_INPUT_SCHEMA,
    resultSchemaId: PLACEMENT_RESULT_SCHEMA,
    resolve: (input) => ({ value: defaultPlacement(input) }),
  };
}

export const TEAM_RESOLVER_SHAPE_BUILDERS: Readonly<
  Record<string, (binding: ResolverBinding) => AnyResolverRegistration>
> = {
  'team:default-placement': placementRegistration,
};
