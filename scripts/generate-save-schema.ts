import { createGenerator } from 'ts-json-schema-generator';
import { readFileSync, writeFileSync } from 'node:fs';
const schema = createGenerator({ path: 'src/app/save/save-state.ts', type: 'SavedGameState', tsconfig: 'tsconfig.json' }).createSchema('SavedGameState');
const text = `${JSON.stringify(schema, null, 2)}\n`;
const file = 'src/app/save/game-state.schema.json';
if (process.argv.includes('--check')) {
  if (JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))) !== JSON.stringify(schema)) {
    throw new Error('Save schema is stale. Run npm run schema:save.');
  }
  console.log('SAVE SCHEMA PASSED');
} else writeFileSync(file, text);
