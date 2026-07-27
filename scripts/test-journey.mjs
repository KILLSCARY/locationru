import { runPnpm } from './process-utils.mjs';

await runPnpm(['dev:seed']);
await runPnpm(['--filter', '@resilient-taxi/api', 'test:journey']);
