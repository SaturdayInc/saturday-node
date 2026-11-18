// Type-checks every response the live suite captured (test/fixtures/live.json) against the SDK
// type it was returned as. Each payload is checked as an object literal, so a field the API sends
// that the type does not declare fails, and so does a required field the API left out.
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';

it('every captured live response satisfies its declared SDK type', () => {
  const captured: Record<string, { type: string; body: unknown }> =
    JSON.parse(readFileSync(join(__dirname, 'fixtures', 'live.json'), 'utf8'));
  expect(Object.keys(captured).length).toBeGreaterThan(40);
  const types = [...new Set(Object.values(captured).map(c => c.type))];
  const source = `import type {${types.join(',')}} from '../src';\n`
    + Object.entries(captured).map(([name, c]) => `export const r_${name}: ${c.type} = ${JSON.stringify(c.body)};`).join('\n');
  const filename = join(__dirname, 'live-fixtures.ts');
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, strict: true, noEmit: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) => file === filename
    ? ts.createSourceFile(file, source, version, true)
    : getSourceFile(file, version, onError, fresh);
  const program = ts.createProgram([filename], options, host);
  const problems = ts.getPreEmitDiagnostics(program).map(d => {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : -1;
    const name = line > 0 ? Object.keys(captured)[line - 1] : '';
    return `${name}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
  expect(problems).toEqual([]);
});
