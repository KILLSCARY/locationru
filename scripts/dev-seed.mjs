import { runCommand, runPnpm } from './process-utils.mjs';

await runCommand('docker', [
  'compose',
  'up',
  '-d',
  '--wait',
  'postgres',
  'redis',
]);
await runPnpm(['--filter', '@resilient-taxi/api', 'prisma:generate']);
await runPnpm(['--filter', '@resilient-taxi/api', 'db:migrate:deploy']);
await runPnpm(['--filter', '@resilient-taxi/api', 'db:seed']);
