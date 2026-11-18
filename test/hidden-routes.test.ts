import { readFileSync } from 'fs';
import { join } from 'path';
import { Saturday } from '../src';

// Routes no partner key reaches. The SDK neither calls nor names them.
const hiddenPaths = ['/v1/products', '/v1/ai/', '/ai/conversations', '/gear'];

it('calls no route that is closed to partners', () => {
  for (const file of ['client.ts', 'types.ts', 'index.ts']) {
    const source = readFileSync(join(__dirname, '..', 'src', file), 'utf8');
    for (const path of hiddenPaths) expect({ file, path, found: source.includes(path) }).toEqual({ file, path, found: false });
  }
});

it('has no products, ai or gear resource', () => {
  const client = new Saturday({ apiKey: 'sk_test_hidden' }) as unknown as Record<string, unknown>;
  for (const resource of ['products', 'ai', 'gear']) expect(client[resource]).toBeUndefined();
});
