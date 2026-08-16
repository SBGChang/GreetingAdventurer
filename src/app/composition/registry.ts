// app/composition/registry.ts
// ModuleRegistry 與啟動時唯一性驗證（12_engine_runtime.md §1、§5.1、§12）。
//
// 職責：收齊全部已實作模組的 ModuleContract，並在進入遊戲前驗證註冊面是否自洽——
// 重複 Handler、缺少 Handler、重複 Slice owner、Manifest 與宣告不一致，全部在此擋下。
// 這些在 Wave B 是「各模組各說各話」的區域：模組只知道自己，沒有人比對過。

import type { ModuleContract, ModuleId } from '../../contracts/core';

import { characterModuleContract } from '../../modules/character/public';
import { INVENTORY_MODULE_CONTRACT } from '../../modules/inventory/public';
import { progressionModuleContract } from '../../modules/progression/public';
import { mapModuleContract } from '../../modules/map/public';
import { dungeonModuleContract } from '../../modules/dungeon/public';
import { combatModuleContract } from '../../modules/combat/public';
import { teamModuleContract } from '../../modules/team/public';

import {
  GAME_COMMAND_ENTRY,
  GAME_COMMAND_OWNER,
  INTERNAL_COMMAND_OWNER,
  type GameCommandType,
  type GameInternalCommandType,
} from './messages';
import {
  EXECUTION_ORDER_MANIFEST,
  REGISTERED_WORKFLOWS,
  UNAVAILABLE_CAPABILITIES,
  validateManifest,
  type ExecutionOrderManifest,
  type ManifestDiagnostic,
} from './manifest';
import { SLICE_OWNER, isGameSliceName, type GameJobType } from './state';
// Router 的**實際** dispatch table：宣告表不能當成 Handler 存在的證據（見下方 5b）。
import { IMPLEMENTED_ROUTES } from './router';

// ──────────────────────────────────────────────────────────────────────────
// 已實作模組
// ──────────────────────────────────────────────────────────────────────────

export const MODULE_CONTRACTS: readonly ModuleContract[] = [
  characterModuleContract,
  INVENTORY_MODULE_CONTRACT,
  progressionModuleContract,
  mapModuleContract,
  dungeonModuleContract,
  combatModuleContract,
  teamModuleContract,
];

export type RegistryDiagnostic = ManifestDiagnostic;

// ──────────────────────────────────────────────────────────────────────────
// 啟動驗證
// ──────────────────────────────────────────────────────────────────────────

export function validateRegistry(
  contracts: readonly ModuleContract[] = MODULE_CONTRACTS,
  manifest: ExecutionOrderManifest = EXECUTION_ORDER_MANIFEST,
): readonly RegistryDiagnostic[] {
  const out: RegistryDiagnostic[] = [];

  // 1) 模組 ID 唯一。
  const seenModuleIds = new Set<string>();
  for (const c of contracts) {
    if (seenModuleIds.has(c.id)) {
      out.push({ code: 'registry.module.duplicateId', detail: `模組 ID "${c.id}" 重複註冊` });
    }
    seenModuleIds.add(c.id);
  }

  // 2) Slice owner 唯一，且與 SLICE_OWNER 一致。
  const sliceOwners = new Map<string, ModuleId>();
  for (const c of contracts) {
    const slice = c.owns as string;
    const previous = sliceOwners.get(slice);
    if (previous !== undefined) {
      out.push({
        code: 'registry.slice.duplicateOwner',
        detail: `Slice "${slice}" 同時被 "${previous}" 與 "${c.id}" 宣告擁有`,
      });
    }
    sliceOwners.set(slice, c.id);
    if (!isGameSliceName(slice)) {
      out.push({
        code: 'registry.slice.unknown',
        detail: `模組 "${c.id}" 宣告擁有未註冊的 Slice "${slice}"`,
      });
    } else if (SLICE_OWNER[slice] !== c.id) {
      out.push({
        code: 'registry.slice.ownerMismatch',
        detail: `Slice "${slice}" 在 SLICE_OWNER 屬於 "${SLICE_OWNER[slice]}"，但由 "${c.id}" 宣告擁有`,
      });
    }
  }

  // 3) 每筆 Game Command 恰好一個入口；宣告與 GAME_COMMAND_OWNER 一致（§5.1）。
  out.push(
    ...crossCheckOwnership({
      label: 'gameCommand',
      declaredBy: contracts.map((c) => [c.id, c.handlesGameCommands] as const),
      owners: GAME_COMMAND_OWNER as Readonly<Record<string, ModuleId>>,
      ownerKeys: Object.keys(GAME_COMMAND_OWNER) as GameCommandType[],
    }),
  );

  // 4) 每筆 Internal Command 恰好一個 Handler。
  out.push(
    ...crossCheckOwnership({
      label: 'internalCommand',
      declaredBy: contracts.map((c) => [c.id, c.handlesInternalCommands] as const),
      owners: INTERNAL_COMMAND_OWNER as Readonly<Record<string, ModuleId>>,
      ownerKeys: Object.keys(INTERNAL_COMMAND_OWNER) as GameInternalCommandType[],
    }),
  );

  // 5) Job Type 恰好一個 Handler，且在 Manifest 中恰好出現一次。
  const jobOwners = new Map<string, ModuleId>();
  for (const c of contracts) {
    for (const jobType of c.handlesJobs) {
      const previous = jobOwners.get(jobType);
      if (previous !== undefined) {
        out.push({
          code: 'registry.job.duplicateHandler',
          detail: `Job type "${jobType}" 同時由 "${previous}" 與 "${c.id}" 註冊`,
        });
      }
      jobOwners.set(jobType, c.id);
    }
  }
  out.push(...validateManifest(manifest, [...jobOwners.keys()] as GameJobType[]));

  // 5b) **宣告 vs 實作**交叉驗證（複審 R15 P1-4）。
  //
  // 這是本函式先前最大的盲點：它只比對 ModuleContract、Owner 表與 Manifest 三份**宣告**彼此是否一致，
  // 而真正的 Handler 表在 router.ts。三份宣告可以完美自洽，Router 卻一個 Handler 都沒有——啟動驗證
  // 全綠，玩家送出命令才拋錯。現在改為直接比對 Router 實際的 dispatch table。
  //
  // 尚未閉合的能力必須**明示**列在 UNAVAILABLE_CAPABILITIES；那份清單只能變短，移除後若仍缺 Handler，
  // 這裡就會失敗。
  const gaps = UNAVAILABLE_CAPABILITIES;
  for (const commandType of Object.keys(GAME_COMMAND_ENTRY)) {
    if (IMPLEMENTED_ROUTES.gameCommands.has(commandType)) continue;
    if (commandType in gaps.gameCommands) continue;
    out.push({
      code: 'registry.gameCommand.noHandler',
      detail: `Game Command "${commandType}" 已宣告入口，但 Router 沒有對應 dispatch，且未列入 UNAVAILABLE_CAPABILITIES`,
    });
  }
  for (const commandType of Object.keys(INTERNAL_COMMAND_OWNER)) {
    if (IMPLEMENTED_ROUTES.internalCommands.has(commandType)) continue;
    if (commandType in gaps.internalCommands) continue;
    out.push({
      code: 'registry.internalCommand.noHandler',
      detail: `Internal Command "${commandType}" 已宣告由模組接收，但 Router 沒有對應 dispatch，且未列入 UNAVAILABLE_CAPABILITIES`,
    });
  }
  for (const jobType of jobOwners.keys()) {
    if (IMPLEMENTED_ROUTES.jobs.has(jobType)) continue;
    if (jobType in gaps.jobs) continue;
    out.push({
      code: 'registry.job.noHandler',
      detail: `Job type "${jobType}" 已宣告由模組處理，但 Router 沒有對應 dispatch，且未列入 UNAVAILABLE_CAPABILITIES`,
    });
  }
  // 5c) **送出端 → Owner** 交叉驗證（複審 R15 P1-5）。
  //
  // 模組可以送出 Internal Command 給別的模組，但過去沒有任何地方宣告「我會送什麼」，
  // Registry 因此驗不到「送出去的命令沒有人收」。dungeon 送 StartAssetDistribution 而
  // Distribution 模組不存在，啟動驗證卻全綠——要等玩家真的開始探索，才在交易中失敗。
  // 現在 ModuleContract.sendsInternalCommands 把送出端也納入宣告，這裡比對它有沒有 Owner。
  for (const c of contracts) {
    for (const commandType of c.sendsInternalCommands) {
      if (commandType in INTERNAL_COMMAND_OWNER) continue;
      if (commandType in gaps.internalCommands) continue;
      out.push({
        code: 'registry.internalCommand.noOwner',
        detail: `模組 "${c.id}" 會送出 Internal Command "${commandType}"，但沒有任何模組宣告接收它，且未列入 UNAVAILABLE_CAPABILITIES`,
      });
    }
  }

  // 清單只能變短：列了卻根本沒有這條路由，代表清單過期。
  // Internal Command 的「已宣告路由」= 有人接收 **或** 有人送出。缺 Owner 的送出端正是需要列入
  // 清單的情形，所以不能只看接收端，否則合法的缺口記錄會被誤判成過期。
  const declaredInternalCommands = new Set<string>([
    ...Object.keys(INTERNAL_COMMAND_OWNER),
    ...contracts.flatMap((c) => c.sendsInternalCommands),
  ]);
  for (const [kind, owners] of [
    ['gameCommands', Object.keys(GAME_COMMAND_ENTRY)],
    ['internalCommands', [...declaredInternalCommands]],
    ['jobs', [...jobOwners.keys()]],
  ] as const) {
    for (const declared of Object.keys(gaps[kind])) {
      if (!(owners as readonly string[]).includes(declared)) {
        out.push({
          code: 'registry.capability.unknownGap',
          detail: `UNAVAILABLE_CAPABILITIES.${kind} 列出的 "${declared}" 不是已宣告的路由`,
        });
      }
    }
  }

  // 6) Manifest 的每筆**模組**訂閱都必須對應到該模組真的註冊過的 subscriptionHandlerId。Workflow 訂閱者
  //    不是模組（其註冊與 startsFrom 由 validateManifest 檢查），故在此模組交叉驗證中跳過。
  const workflowIds = new Set<string>(REGISTERED_WORKFLOWS.map((w) => String(w.workflowId)));
  const declaredSubscriptionIds = new Map<string, Set<string>>();
  for (const c of contracts) {
    declaredSubscriptionIds.set(c.id, new Set(c.subscriptionHandlerIds as readonly string[]));
  }
  for (const subs of Object.values(manifest.eventSubscriptionsByType)) {
    for (const s of subs ?? []) {
      if (workflowIds.has(String(s.subscriber))) continue; // Workflow 訂閱者跳過模組交叉驗證
      const declared = declaredSubscriptionIds.get(s.subscriber);
      if (declared === undefined) {
        out.push({
          code: 'registry.subscription.unknownModule',
          detail: `subscription "${s.subscriptionId}" 指向未註冊模組 "${s.subscriber}"`,
        });
        continue;
      }
      if (!declared.has(s.subscriptionId)) {
        out.push({
          code: 'registry.subscription.notDeclared',
          detail: `模組 "${s.subscriber}" 未在 subscriptionHandlerIds 註冊 "${s.subscriptionId}"`,
        });
      }
    }
  }

  return out;
}

// 共用的「宣告 ↔ owner 表」雙向比對。
function crossCheckOwnership(input: {
  label: string;
  declaredBy: readonly (readonly [ModuleId, readonly string[]])[];
  owners: Readonly<Record<string, ModuleId>>;
  ownerKeys: readonly string[];
}): readonly RegistryDiagnostic[] {
  const out: RegistryDiagnostic[] = [];
  const declared = new Map<string, ModuleId>();

  for (const [moduleId, types] of input.declaredBy) {
    for (const type of types) {
      const previous = declared.get(type);
      if (previous !== undefined) {
        out.push({
          code: `registry.${input.label}.duplicateHandler`,
          detail: `"${type}" 同時由 "${previous}" 與 "${moduleId}" 註冊處理`,
        });
      }
      declared.set(type, moduleId);
    }
  }

  for (const type of input.ownerKeys) {
    const owner = input.owners[type];
    const declaredOwner = declared.get(type);
    if (declaredOwner === undefined) {
      out.push({
        code: `registry.${input.label}.missingHandler`,
        detail: `"${type}" 在 owner 表指定由 "${owner}" 處理，但該模組沒有註冊它`,
      });
    } else if (declaredOwner !== owner) {
      out.push({
        code: `registry.${input.label}.ownerMismatch`,
        detail: `"${type}" 的 owner 表是 "${owner}"，實際註冊者是 "${declaredOwner}"`,
      });
    }
  }

  for (const [type, moduleId] of declared) {
    if (!(type in input.owners)) {
      out.push({
        code: `registry.${input.label}.unmapped`,
        detail: `模組 "${moduleId}" 註冊了 "${type}"，但 owner 表沒有這一筆`,
      });
    }
  }

  return out;
}
