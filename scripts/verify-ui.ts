import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fnv1a64, toHex16 } from '../src/kernel/hash';

// Exercise the shipped facade through Vite, including import.meta.glob content loading.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createGame } = await server.ssrLoadModule('/engine/game-facade.ts');
  const { readSave, writeSave, restoreSave } = await server.ssrLoadModule('/engine/save-storage.ts');
  const config = {
    worldSeed: 'ui-regression', startDay: 14600,
    startingArchetypeId: 'character-archetype.core.player-lineage',
    startCityId: 'city-node.yunhua.yunjing', leaderSex: 'female', leaderBirthDay: 5475, startingMoney: 5000,
  };
  const game = createGame(config);
  const initial = game.serialize();
  const inspectWorld = (save: string) => {
    const state = JSON.parse(JSON.parse(save).payload).state;
    const available = Object.values(state.map.contents).filter((c: any) => c.state === 'available') as { kind: string }[];
    const kinds = (values: { kind: string }[]) => Object.fromEntries([...new Set(values.map(c=>c.kind))].sort().map(kind=>[kind, values.filter(c=>c.kind===kind).length]));
    return { mapContents: kinds(available), shopOffers: Object.values(state.city.shopOffers).filter((offer: any)=>offer.state === 'available').length,
      questKinds: [...new Set(Object.values(state.quest.quests).map((q: any)=>q.kind))].sort() };
  };
  const openingWorld = inspectWorld(initial);
  assert(openingWorld.shopOffers > 0, 'bootstrap must stock shops before the first player action');
  assert(openingWorld.mapContents.monsterGroup > 0, 'bootstrap must populate maps before the first player action');
  assert.deepEqual(openingWorld.questKinds, ['hunt','suppression'], 'only complete quest workflows may be published');

  assert.deepEqual(createGame(config, initial).view, game.view, 'new-game save must round-trip');
  let result;
  const jobTypes = new Set<string>();
  for (let day = 0; day < 35; day++) {
    result = game.runCommand({ type: 'rest', planKind: 'cityFacilityAction' });
    assert.equal(result.accepted, true);
    assert.equal(result.blocked, undefined, `world stopped on day ${day}: ${result.blocked}`);
    assert.equal(result.view.worldDay, config.startDay + day + 1);
    const planIndex = result.settled.findIndex((step: { jobType: string }) => step.jobType === 'teamPlanDue');
    const mapIndex = result.settled.findIndex((step: { jobType: string }) => step.jobType === 'mapRefreshCheck');
    if (mapIndex >= 0) assert(planIndex >= 0 && planIndex < mapIndex, 'same-day action completion must precede world cadence');
    for (const step of result.settled) jobTypes.add(step.jobType);
  }
  const agedWorld = inspectWorld(game.serialize());
  assert.deepEqual(agedWorld.questKinds, openingWorld.questKinds, 'time alone must not activate incomplete quest workflows');
  console.log('WORLD SOURCES (opening / after 35 normal days):', JSON.stringify([openingWorld, agedWorld]));
  assert(jobTypes.has('mapRefreshCheck'), 'maps must refresh during normal play');
  assert(jobTypes.has('questDeadline'), 'quest deadlines must run during normal play');
  assert(jobTypes.has('shopRefresh'), 'shops must refresh during normal play');
  assert.deepEqual(createGame(config, game.serialize()).view, result.view, 'progress must survive reload');
  const resumed = createGame(config, game.serialize());
  assert.deepEqual(resumed.runCommand({ type: 'rest', planKind: 'cityFacilityAction' }),
    game.runCommand({ type: 'rest', planKind: 'cityFacilityAction' }), 'resume must preserve RNG and scheduler');
  assert.throws(() => createGame(config, initial.replace('ui-regression', 'changed-seed')), /checksum/);
  const editedSave = (edit: (payload: any) => void) => {
    const payload = JSON.parse(JSON.parse(initial).payload);
    edit(payload);
    const text = JSON.stringify(payload);
    return JSON.stringify({ payload: text, checksum: toHex16(fnv1a64(text)) });
  };
  assert.throws(() => createGame(config, editedSave(p => { p.content.manifestHash = 'different-content'; })), /content-incompatible/);
  assert.throws(() => createGame(config, editedSave(p => { p.state.core.worldDay = 'broken'; })), /invalid-state/);
  assert.throws(() => createGame(config, editedSave(p => { p.state.core.worldDay = -1; })), /invalid-core/);
  assert.throws(() => createGame(config, editedSave(p => { p.state.character.characters = {}; })), /invalid-player-team/);
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  writeSave(storage, initial);
  writeSave(storage, game.serialize());
  assert.equal(readSave(storage, true), initial);
  const before = readSave(storage);
  assert.throws(() => writeSave({ ...storage, setItem: () => { throw new Error('quota'); } }, 'replacement'), /quota/);
  assert.equal(readSave(storage), before, 'failed write must preserve primary save');
  const backup = readSave(storage, true);
  assert.throws(() => restoreSave({ ...storage, setItem: () => { throw new Error('quota'); } }, backup), /quota/);
  assert.equal(readSave(storage, true), backup, 'failed recovery must not destroy the good backup');
  const trainee = createGame(config);
  const training = trainee.view.city.trainings.find((t: { options: unknown[] }) => t.options.length > 0);
  assert(training, 'training content missing');
  assert(trainee.runCommand({ type: 'beginCityFreePeriod' }).accepted);
  const trained = trainee.runCommand({ type: 'chooseCityFreeAction', memberId: trainee.view.leader.id,
    ruleId: training.ruleId, payload: { kind: 'train', masteryId: training.options[0].masteryId } });
  assert.equal(trained.accepted, true);
  assert.equal(trained.blocked, undefined, `long action blocked: ${trained.blocked}`);
  assert.equal(trained.view.worldDay, config.startDay + training.requiredDays);
  assert(trained.settled.length > 64, 'training must exercise the world budget beyond the combat limit');
  console.log('UI INTEGRATION PASSED: facade, 35 days, long training, recurring map/shop jobs, save/reload/replay, backup, failed write');
} finally {
  await server.close();
}
