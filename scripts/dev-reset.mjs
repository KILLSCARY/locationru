import { runCommand, runPnpm } from './process-utils.mjs';

console.warn(
  'Resetting Resilient Taxi development PostgreSQL and Redis volumes.',
);
await runCommand('docker', [
  'compose',
  'down',
  '--volumes',
  '--remove-orphans',
]);
await runPnpm(['dev:seed']);
