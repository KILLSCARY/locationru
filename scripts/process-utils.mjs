import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
}

export function spawnPnpm(args, options = {}) {
  const pnpmEntrypoint = process.env.npm_execpath;

  if (pnpmEntrypoint) {
    return spawnCommand(process.execPath, [pnpmEntrypoint, ...args], options);
  }

  return spawnCommand(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
    options,
  );
}

export async function runCommand(command, args, options = {}) {
  const child = spawnCommand(command, args, options);
  const code = await waitForExit(child);

  if (code !== 0) {
    throw new Error(`${command} exited with code ${code ?? 'unknown'}`);
  }
}

export async function runPnpm(args, options = {}) {
  const child = spawnPnpm(args, options);
  const code = await waitForExit(child);

  if (code !== 0) {
    throw new Error(
      `pnpm ${args.join(' ')} exited with code ${code ?? 'unknown'}`,
    );
  }
}

export function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
}

export async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.killed) return;

  if (process.platform === 'win32') {
    const taskkill = spawn(
      'taskkill',
      ['/PID', String(child.pid), '/T', '/F'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    await waitForExit(taskkill);
    return;
  }

  child.kill('SIGTERM');
}
