// Copies non-TypeScript runtime assets (the SQL schema) into dist/ after `tsc`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = ['database/schema.sql'];

for (const asset of assets) {
  const target = join(root, 'dist', asset);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, 'src', asset), target);
  console.log(`copied src/${asset} -> dist/${asset}`);
}
