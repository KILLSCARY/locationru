import {
  runPnpm,
  spawnCommand,
  spawnPnpm,
  stopChild,
  waitForExit,
} from './process-utils.mjs';

console.log(
  'Preparing PostgreSQL/PostGIS, Redis, migrations and test accounts...',
);
await runPnpm(['dev:seed']);

console.log(
  'Development mocks are enabled inside API: SMS, trip payment and payment architecture providers.',
);

const adminWebPort = integerEnvironment('ADMIN_WEB_PORT', 1, 65_535, 3001);

const children = [
  spawnPnpm(['--filter', '@resilient-taxi/api', 'start:dev']),
  spawnPnpm([
    '--filter',
    '@resilient-taxi/admin-web',
    'exec',
    'next',
    'dev',
    '--port',
    String(adminWebPort),
  ]),
  spawnCommand(process.execPath, ['scripts/driver-location-generator.mjs']),
];

let stopping = false;

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map((child) => stopChild(child)));
  process.exitCode = exitCode;
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

const firstExit = await Promise.race(
  children.map(async (child) => ({
    child,
    code: await waitForExit(child),
  })),
);

if (!stopping) {
  console.error(
    `A development stack process exited with code ${firstExit.code ?? 'unknown'}.`,
  );
  await shutdown(firstExit.code ?? 1);
}

function integerEnvironment(name, minimum, maximum, fallback) {
  const value = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }

  return value;
}
