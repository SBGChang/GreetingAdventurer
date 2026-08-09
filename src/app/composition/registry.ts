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
  GAME_COMMAND_OWNER,
  INTERNAL_COMMAND_OWNER,
  type GameCommandType,
  type GameInternalCommandType,
} from './messages';
import {
  EXECUTION_ORDER_MANIFEST,
  validateManifest,
  type ExecutionOrderManifest,
  type ManifestDiagnostic,
} from './manifest';
import { SLICE_OWNER, isGameSliceName, type GameJobType } from './state';

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

  // 6) Manifest 的每筆 subscription 都必須對應到該模組真的註冊過的 subscriptionHandlerId。
  const declaredSubscriptionIds = new Map<string, Set<string>>();
  for (const c of contracts) {
    declaredSubscriptionIds.set(c.id, new Set(c.subscriptionHandlerIds as readonly string[]));
  }
  for (const subs of Object.values(manifest.eventSubscriptionsByType)) {
    for (const s of subs ?? []) {
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
