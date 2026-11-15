import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as sdk from '../src';

const root = join(__dirname, '..');

it('names every runtime export of the SDK in the ES module entry', () => {
  const entry = readFileSync(join(root, 'esm', 'index.mjs'), 'utf8');
  const named = entry.match(/export const \{([\s\S]*?)\} = cjs;/)![1].split(',').map(s => s.trim()).filter(Boolean);
  const runtime = Object.keys(sdk).filter(name => name !== 'default' && name !== '__esModule');
  expect(named.sort()).toEqual(runtime.sort());
});

// The README's `import Saturday from '@saturdayinc/sdk'` under Node's own ES modules, where the
// default import of a CommonJS package is the module object and `new Saturday()` threw.
it('gives a plain Node ES module the client class as the default import', () => {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc')], { cwd: root });
  const script = [
    "import Saturday, { Saturday as Named, ValidationError } from '@saturdayinc/sdk';",
    "const client = new Saturday({ apiKey: 'sk_test_x' });",
    "console.log(JSON.stringify([typeof Saturday, Saturday === Named, typeof client.nutrition.calculate, typeof ValidationError]));",
  ].join('\n');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  expect(JSON.parse(out)).toEqual(['function', true, 'function', 'function']);
}, 120000);
