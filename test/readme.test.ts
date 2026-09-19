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

it.each([
  ['exact', { tier: 'full', carb_g_per_hr: 70, sodium_mg_per_hr: 900, fluid_ml_per_hr: 1000 }, ['70', '900', '1000']],
  ['incomplete full', { tier: 'full', carb_range_g_per_hr: '60-80', sodium_range_mg_per_hr: '800-1000', fluid_range_ml_per_hr: '900-1100' }, ['60-80', '800-1000', '900-1100']],
  ['teaser', { tier: 'teaser', carb_range_g_per_hr: '60-90', sodium_range_mg_per_hr: '500-1000', fluid_range_ml_per_hr: '500-1000' }, ['60-90', '500-1000', '500-1000']],
  ['omitted exact zeros', { tier: 'full' }, ['0', '0', '0']],
])('executes the README quickstart for %s responses', async (_name, payload, values) => {
  global.fetch = jest.fn().mockImplementation(async (_url, init) => {
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toMatchObject({ activity_type: 'bike', duration_min: 180 });
    return Response.json({ ...payload, safety: { warnings: [] } });
  });
  const log = jest.fn();
  const execute = new AsyncFunction('require', 'exports', 'console', javascript);

  await execute((name: string) => {
    if (name !== '@saturdayinc/sdk') throw new Error(`Unexpected module ${name}`);
    return sdk;
  }, {}, { log });

  expect(log.mock.calls).toEqual([
    [[]], [`Carbs: ${values[0]} g/hr`], [`Sodium: ${values[1]} mg/hr`], [`Fluid: ${values[2]} mL/hr`],
  ]);
});

it.each([
  ['stored_exact', null, '60'],
  ['stored_banded', [], '50-70'],
  ['stored_banded', ['Review this recommendation'], '50-70'],
])('executes the README stored-prescription example for %s with warnings %j', async (name, warnings, carbs) => {
  const root = join(__dirname, '..');
  const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contracts.json'), 'utf8'));
  const payload = fixtures[name as string];
  global.fetch = jest.fn().mockImplementation(async (url, init) => {
    expect(url).toBe('https://api.saturday.fit/v1/athletes/ath_123/activities/act_123/prescription');
    expect(init?.method).toBe('GET');
    return Response.json({ ...payload, safety: { ...payload.safety, warnings } });
  });
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const example = [...readme.matchAll(/```typescript\n([\s\S]*?)```/g)]
    .find(match => match[1].includes('getPrescription'))![1];
  const compiled = ts.transpileModule(example, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const log = jest.fn();
  await new AsyncFunction('Saturday', 'console', compiled)(sdk.Saturday, { log });
  expect(log.mock.calls).toEqual([[`Carbs: ${carbs} g/hr`], ...((warnings ?? []) as string[]).map(warning => [warning])]);
});
