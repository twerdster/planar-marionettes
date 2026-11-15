// Preserve the recovered historical report/figure independently of new code.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const originals = [
  ['../../../docs/report.pdf', 'bcbac66e0e988cd3a82a8a9d8692d549451502757b773248327d3eb9d87bbb92'],
  ['../../../assets/project-preview.png', '211f68885c94bf67c8488e77ee129561d97b6c21ac9aa570e4fc60613687e741'],
];
for (const [relative, expected] of originals) {
  const url = new URL(relative, import.meta.url);
  const hash = createHash('sha256').update(await readFile(url)).digest('hex');
  if (hash !== expected) throw new Error(`Historical original changed: ${relative}`);
  console.log(`${relative}: original SHA-256 verified`);
}
