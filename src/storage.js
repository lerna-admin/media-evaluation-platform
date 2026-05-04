import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const storagePath = resolve(__dirname, '../data/catalog.json');

export async function readStore() {
  const raw = await readFile(storagePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeStore(store) {
  await writeFile(storagePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}
