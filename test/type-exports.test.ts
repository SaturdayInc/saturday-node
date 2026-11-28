// Every model declared in src/types.ts must be importable from the package
// entry. AppLevel and AppSaltiness were missing from src/index.ts, so a
// consumer could not name the types that NutritionCalculateRequest fields
// (sweat_level, saltiness, ...) are declared with.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Saturday, type AppLevel, type AppSaltiness, type NutritionCalculateRequest } from '../src';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it('exports AppLevel and AppSaltiness as names for the calculate level fields', async () => {
  const sweat: AppLevel = 7;
  const saltiness: AppSaltiness = 5;
  const request: NutritionCalculateRequest = {
    activity_type: 'run', duration_min: 60, sweat_level: sweat, saltiness,
    satiety_level: 5, fitness_level: 9,
  };
  const mock = jest.fn().mockResolvedValue(Response.json({ tier: 'teaser' }));
  global.fetch = mock;
  await new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 }).nutrition.calculate(request);
  expect(JSON.parse(mock.mock.calls[0][1].body)).toMatchObject({ sweat_level: 7, saltiness: 5 });
});

it('re-exports every type and interface declared in src/types.ts', () => {
  const typesSource = readFileSync(join(__dirname, '..', 'src', 'types.ts'), 'utf8');
  const declared = [...typesSource.matchAll(/^export (?:interface|type) (\w+)/gm)].map(m => m[1]);
  const indexSource = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const end = indexSource.indexOf("} from './types';");
  const block = indexSource.slice(indexSource.lastIndexOf('export type {', end), end);
  const reExported = new Set([...block.matchAll(/\b[A-Z]\w+\b/g)].map(m => m[0]));
  expect(declared.filter(name => !reExported.has(name))).toEqual([]);
  expect(declared.length).toBeGreaterThan(150);
});
