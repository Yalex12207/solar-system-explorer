/**
 * Production build wrapper.
 *
 * esbuild resolves its scratch directory from `os.tmpdir()`, which on Windows honours
 * `TMP`/`TEMP`. When the system temp directory is held by another process (an editor
 * indexer, a scanner, a leftover process), esbuild fails with
 * `[vite:esbuild-transpile] remove ...: Access is denied` and the whole build aborts —
 * a failure that has nothing to do with the project.
 *
 * Pointing the scratch directory at a workspace-local folder makes the build
 * self-contained and reproducible. `ESBUILD_TMPDIR` is not honoured by esbuild's JS
 * API, so the environment variables it does read are set here instead.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(root, '.esbuild-tmp');
mkdirSync(scratch, { recursive: true });

const result = spawnSync('npx', ['vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    TMP: scratch,
    TEMP: scratch,
  },
});

process.exit(result.status ?? 1);
