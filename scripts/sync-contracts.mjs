import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
// Use --show-toplevel to find the current checkout's root (main repo or worktree).
// This ensures we sync from the correct source, whether run from main or worktree.
const currentRoot = execSync('git rev-parse --path-format=absolute --show-toplevel', { cwd: scriptDir })
  .toString()
  .trim();
// Use --git-common-dir to find the main repo's root, invariant across worktrees.
// This ensures the target (sibling go-bingo-front) is always found correctly.
const gitCommonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: scriptDir })
  .toString()
  .trim();
const mainRoot = dirname(gitCommonDir);
const source = join(currentRoot, 'src', 'contracts');
const target = join(mainRoot, '..', 'go-bingo-front', 'src', 'contracts');
const header = '// GERADO por go-bingo-back/scripts/sync-contracts.mjs — NÃO EDITAR. Edite no back e rode `npm run contracts:sync`.\n';

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const files = readdirSync(source).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
for (const file of files) {
  writeFileSync(join(target, file), header + readFileSync(join(source, file), 'utf8'));
}
console.log(`contracts: ${files.length} arquivos copiados para ${target}`);
