import type { ModuleId, WorkflowId } from '../../contracts/core';
import type { MapContentResolved } from '../../contracts/map';
import type { ItemInstanceCreated, CreateItemInstance } from '../../contracts/inventory';
import type { AppendAssetDistributionResultCommand } from '../../contracts/distribution';
import { tryGetContent } from '../../modules/map/public';
import type { WorkflowSubscriberDispatch } from './player-travel-event';

export const ADVENTURE_LOOT_WORKFLOW = 'workflow:adventure-loot' as WorkflowId;
export const COLLECT_LOOT_WORKFLOW = 'workflow:collect-loot' as WorkflowId;

const onContentResolved: WorkflowSubscriberDispatch = (value, state, contexts) => {
  const event = value as MapContentResolved;
  if (event.resolution.kind !== 'combatEncounter' || event.resolution.outcome !== 'success') return { outgoing: [] };
  const distributionId = event.distributionId;
  if (!distributionId) return { outgoing: [] };
  const content = tryGetContent(state.map, event.contentId);
  if (!content || (content.payload.kind !== 'monsterGroup' && content.payload.kind !== 'boss')) return { outgoing: [] };
  if (!contexts) throw new Error('adventure-loot/context-missing');
  const group = contexts.combat.definitions.getEncounterGroup(content.payload.encounterGroupId);
  return { outgoing: (group.itemRewards === undefined ? [] : group.itemRewards).map(reward => {
    const command: CreateItemInstance = { type: 'CreateItemInstance', definitionId: reward.itemDefinitionId,
      quantity: reward.quantity, location: { kind: 'assetDistributionEscrow', distributionId }, reason: 'adventure.combatReward' };
    return { targetModule: 'inventory' as ModuleId, command };
  }) };
};

const onItemCreated: WorkflowSubscriberDispatch = value => {
  const event = value as ItemInstanceCreated;
  if (event.location.kind !== 'assetDistributionEscrow') return { outgoing: [] };
  const command: AppendAssetDistributionResultCommand = { type: 'AppendAssetDistributionResult',
    distributionId: event.location.distributionId, itemIds: [event.itemId], currencyInputs: [] };
  return { outgoing: [{ targetModule: 'distribution' as ModuleId, command }] };
};

export const WORKFLOW_SUBSCRIBERS: Readonly<Record<string, WorkflowSubscriberDispatch>> = {
  [`MapContentResolved::${ADVENTURE_LOOT_WORKFLOW}`]: onContentResolved,
  [`ItemInstanceCreated::${COLLECT_LOOT_WORKFLOW}`]: onItemCreated,
};
