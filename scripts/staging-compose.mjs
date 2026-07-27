import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { repositoryRoot, runCommand } from './process-utils.mjs';

const environmentPath = join(repositoryRoot, '.env.staging');
const composePath = join(repositoryRoot, 'docker-compose.staging.yml');
const action = process.argv[2];

const actions = {
  up: ['up', '-d', '--build', '--wait'],
  down: ['down', '--remove-orphans'],
  status: ['ps'],
  logs: ['logs', '--follow', '--tail', '200'],
  backups: [
    'exec',
    '-T',
    'backup-sync',
    '/bin/sh',
    '-c',
    'mc ls "staging/$MINIO_BACKUP_BUCKET"',
  ],
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!existsSync(environmentPath)) {
    throw new Error('Run pnpm staging:init before using the staging stack.');
  }

  if (action === 'cert') {
    await exportCertificate();
    return;
  }

  if (action === 'backup') {
    await createBackups();
    return;
  }

  const actionArguments = actions[action];
  if (!actionArguments) {
    throw new Error(`Unknown staging action "${action ?? ''}".`);
  }

  await runCommand('docker', [
    'compose',
    '--env-file',
    environmentPath,
    '--file',
    composePath,
    ...actionArguments,
  ]);
}

async function createBackups() {
  await runCompose([
    'exec',
    '-T',
    'postgres-backup',
    '/bin/sh',
    '/opt/staging/postgres-backup-once.sh',
  ]);
  await runCompose([
    'exec',
    '-T',
    'redis-backup',
    '/bin/sh',
    '/opt/staging/redis-backup-once.sh',
  ]);
  console.log('PostgreSQL and Redis backups completed.');
}

async function exportCertificate() {
  const outputDirectory = join(repositoryRoot, '.staging');
  const certificatePath = join(outputDirectory, 'caddy-root.crt');

  mkdirSync(outputDirectory, { recursive: true });
  await runCompose([
    'cp',
    'caddy:/data/caddy/pki/authorities/local/root.crt',
    certificatePath,
  ]);

  console.log(`Caddy root certificate exported to ${certificatePath}`);
  if (process.platform === 'win32') {
    console.log(
      `Trust it for the current Windows user with: certutil -user -addstore Root "${certificatePath}"`,
    );
  } else {
    console.log(
      'Import this certificate into the local user trust store if trusted browser HTTPS is required.',
    );
  }
}

async function runCompose(arguments_) {
  await runCommand('docker', [
    'compose',
    '--env-file',
    environmentPath,
    '--file',
    composePath,
    ...arguments_,
  ]);
}
