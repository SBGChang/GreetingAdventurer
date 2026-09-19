import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadContentFromDisk } from '../src/platform/content-repository';
import { createCharacterNameReader, validateCharacterNames } from '../src/app/content/character-name-reader';
import { generateCharacterName, characterNameDisplay } from '../src/modules/character/public';
import { renderCharacterName, type CharacterName } from '../src/contracts/character/names';
import { deterministicRng } from '../src/kernel/rng';
import { fnv1a64, toHex16 } from '../src/kernel/hash';
import type { GameHandle } from '../app/engine/game-facade';
import type { NewGameConfig } from '../src/app/composition/new-game-bootstrap';

export function verifyNaming(createGame: (config: NewGameConfig, saved?: string) => GameHandle, config: NewGameConfig): void {
  const loaded = loadContentFromDisk('content');
  if (!loaded.success) throw new Error('naming/content-load-failed');
  const reader = createCharacterNameReader(loaded.registry);
  validateCharacterNames(loaded.registry, loaded.localization);
  assert.throws(() => validateCharacterNames(loaded.registry, { ...loaded.localization,
    resolve: (locale, ref) => locale === 'en' ? undefined : loaded.localization.resolve(locale, ref) }), /name-translation-missing/);
  for (const culture of ['yunhua', 'vildun', 'aurelien', 'safir']) {
    for (const sex of ['male', 'female'] as const) {
      const names: CharacterName[] = [];
      for (let i = 0; i < 40; i++) {
        const input = { worldSeed: 'naming-test' as never, characterId: `test-${i}` as never,
          cultureId: `culture.${culture}` as never, sex, existingNames: names };
        const name = generateCharacterName(reader, deterministicRng, input);
        assert.deepEqual(generateCharacterName(reader, deterministicRng, input), name, 'same inputs replay the same name');
        assert(!names.some(n => JSON.stringify(n) === JSON.stringify(name)), 'avoid full-name collisions');
        const display = characterNameDisplay(reader, name);
        for (const locale of ['zh-Hant', 'en']) {
          const rendered = renderCharacterName(display, ref => loaded.localization.resolve(locale, ref)!);
          assert(rendered && !/[{}]|undefined|character-name/.test(rendered));
          assert.equal(/[\u3400-\u9fff]/.test(rendered), locale === 'zh-Hant', 'English names must actually be transliterated');
          if (culture === 'yunhua') assert(!['魏成', 'Wei Cheng'].includes(rendered), 'fixed host names are reserved');
        }
        names.push(name);
      }
      const rule = reader.ruleForCulture(`culture.${culture}` as never);
      const singleRule = { ...rule, familyIds: [rule.familyIds[0]!], maleGivenIds: [rule.maleGivenIds[0]!], femaleGivenIds: [rule.femaleGivenIds[0]!], reservedNames: [] };
      const singleReader = { ...reader, ruleForCulture: () => singleRule };
      const input = { worldSeed: 'pool-full' as never, characterId: 'test' as never, cultureId: rule.cultureId, sex, existingNames: [] };
      const only = generateCharacterName(singleReader, deterministicRng, input);
      assert.deepEqual(generateCharacterName(singleReader, deterministicRng, { ...input, existingNames: [only] }), only, 'exhausted pools terminate and allow balanced repeats');
    }
  }
  const game = createGame(config);
  const before = game.serialize();
  for (const locale of ['zh-Hant', 'en'] as const) {
    const text = (ref: Parameters<GameHandle['resolveText']>[1]) => game.resolveText(locale, ref)!;
    assert(renderCharacterName(game.view.sheet.name, text));
    for (const visitor of game.view.city!.tavern!.visitors) assert(renderCharacterName(visitor.name, text));
    assert.equal(renderCharacterName(game.view.formation.names[game.view.leader.id]!, text), renderCharacterName(game.view.sheet.name, text));
  }
  assert.equal(game.serialize(), before, 'changing the display locale never changes state or RNG');
  let recruited = false;
  for (const visitor of game.view.city!.tavern!.visitors) {
    const result = game.runCommand({ type: 'recruitTavernAdventurer', targetCharacterId: visitor.characterId as never });
    assert(result.accepted);
    if (result.view.formation.members.includes(visitor.characterId as never)) {
      assert.deepEqual(result.view.formation.names[visitor.characterId], visitor.name, 'joining the party preserves the tavern name');
      assert.deepEqual(createGame(config, game.serialize()).view.formation.names[visitor.characterId], visitor.name);
      recruited = true; break;
    }
  }
  assert(recruited, 'fixture seed must exercise a successful recruitment');
  const customGame = createGame({ ...config, leaderName: '小雨 / 雨音' });
  for (const locale of ['zh-Hant', 'en'] as const) assert.equal(renderCharacterName(customGame.view.sheet.name, ref => customGame.resolveText(locale, ref)!), '小雨 / 雨音');
  assert.deepEqual(createGame(config, customGame.serialize()).view.sheet.name, customGame.view.sheet.name);
  const old = gunzipSync(readFileSync('src/testing/fixtures/pre-naming.save.json.gz')).toString('utf8');
  const previous = JSON.parse(JSON.parse(old).payload).state;
  const upgraded = createGame(config, old);
  const next = JSON.parse(JSON.parse(upgraded.serialize()).payload).state;
  for (const character of Object.values(next.character.characters) as any[]) {
    assert(character.name);
    delete character.name;
  }
  assert.deepEqual(next, previous, 'name migration may only add names, preserving all progress, RNG, jobs and inventory');
  assert.deepEqual(createGame(config, old).view, upgraded.view, 'migration is deterministic');
  assert.equal(createGame(config, upgraded.serialize()).serialize(), upgraded.serialize(), 'upgrading twice is idempotent');
  const corrupt = (change: (payload: any) => void) => {
    const payload = JSON.parse(JSON.parse(before).payload); change(payload);
    const text = JSON.stringify(payload); return JSON.stringify({ payload: text, checksum: toHex16(fnv1a64(text)) });
  };
  assert.throws(() => createGame(config, corrupt(p => { delete Object.values<any>(p.state.character.characters)[0].name; })), /invalid-state/);
  assert.throws(() => createGame(config, corrupt(p => { Object.values<any>(p.state.character.characters)[0].name.givenId = 'missing'; })), /invalid-name-reference/);
  console.log('NAMING PASSED: four cultures, two locales, deterministic choice, duplicate/reserved names, finite exhaustion, custom names, strict saves, exact predecessor migration');
}
