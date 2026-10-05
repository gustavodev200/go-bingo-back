import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'contracts');
const target = join(root, '..', 'go-bingo-front', 'src', 'contracts');
const header = '// GERADO por go-bingo-back/scripts/sync-contracts.mjs — NÃO EDITAR. Edite no back e rode `npm run contracts:sync`.\n';

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const files = readdirSync(source).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
for (const file of files) {
  writeFileSync(join(target, file), header + readFileSync(join(source, file), 'utf8'));
}
console.log(`contracts: ${files.length} arquivos copiados para ${target}`);
