import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import * as sdk from '../src';

const originalFetch = global.fetch;
const source = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')
  .match(/```typescript\n([\s\S]*?)```/)![1];
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

afterEach(() => { global.fetch = originalFetch; });

it('type-checks the README TypeScript examples against this SDK', () => {
  const root = join(__dirname, '..');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const sources = new Map([...readme.matchAll(/```typescript\n([\s\S]*?)```/g)].map((match, i) => [
    join(__dirname, `readme-example-${i}.ts`),
    (match[1].includes('import Saturday') ? '' : "import Saturday from '@saturdayinc/sdk';\n") + match[1],
  ]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10, strict: true, skipLibCheck: true,
    noEmit: true, esModuleInterop: true, baseUrl: root,
    paths: { '@saturdayinc/sdk': ['src/index.ts'] },
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) => sources.has(file)
    ? ts.createSourceFile(file, sources.get(file)!, version, true)
    : getSourceFile(file, version, onError, fresh);
  const program = ts.createProgram([...sources.keys()], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
});

const athlete = { id: 'ath_1', partner_id: 'partner_example', settings: {}, profile_complete: true, created_at: 1, updated_at: 1 };

it.each([
  ['exact', { tier: 'full', carb_g_per_hr: 70, sodium_mg_per_hr: 900, fluid_ml_per_hr: 1000, precision: { profile_complete: true } },
    ['Carbs: 70 g/hr', 'Sodium: 900 mg/hr', 'Fluid: 1000 mL/hr']],
  ['ranges', { tier: 'full', carb_range_g_per_hr: '60-80', sodium_range_mg_per_hr: '800-1000', fluid_range_ml_per_hr: '900-1100', precision: { profile_complete: false } },
    ['Carbs: 60-80 g/hr', 'Sodium: 800-1000 mg/hr', 'Fluid: 900-1100 mL/hr']],
  ['omitted exact zero', { tier: 'full', carb_g_per_hr: 70, fluid_ml_per_hr: 500, precision: { profile_complete: true } },
    ['Carbs: 70 g/hr', 'Sodium: 0 mg/hr', 'Fluid: 500 mL/hr']],
])('executes the README quick start for %s responses', async (_name, payload, lines) => {
  global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string);
    if (url.endsWith('/v1/athletes')) {
      expect(body).toMatchObject({ external_id: 'user-42', settings: { concerns_answered: true } });
      return Response.json(athlete, { status: 201 });
    }
    expect(url).toBe('https://api.saturday.fit/v1/nutrition/calculate');
    expect(body).toMatchObject({ athlete_id: 'ath_1', activity_type: 'bike', duration_min: 180, meal_before_min: 120, is_race: false });
    return Response.json({ ...payload, safety: { warnings: ['Drink to thirst above this rate.'] } });
  });
  const log = jest.fn();
  const execute = new AsyncFunction('require', 'exports', 'console', 'process', javascript);

  await execute((name: string) => {
    if (name !== '@saturdayinc/sdk') throw new Error(`Unexpected module ${name}`);
    return sdk;
  }, {}, { log }, { env: { SATURDAY_API_KEY: 'sk_test_fake' } });

  expect(log.mock.calls).toEqual([...lines.map(line => [line]), ['Drink to thirst above this rate.']]);
});
