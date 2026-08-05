import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { repositoryRoot } from './process-utils.mjs';

const templatePath = join(repositoryRoot, '.env.staging.example');
const targetPath = join(repositoryRoot, '.env.staging');

if (existsSync(targetPath)) {
  console.log(
    '.env.staging already exists; existing local secrets were not changed.',
  );
  process.exit(0);
}

const generatedValues = {
  POSTGRES_PASSWORD: randomSecret(),
  REDIS_PASSWORD: randomSecret(),
  MINIO_ROOT_PASSWORD: randomSecret(),
  AUTH_JWT_SECRET: randomSecret(),
  AUTH_OTP_HASH_SECRET: randomSecret(),
  TRIPS_BOARDING_CODE_HASH_SECRET: randomSecret(),
};

const environment = readFileSync(templatePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex < 1) return line;

    const name = line.slice(0, separatorIndex);
    const generatedValue = generatedValues[name];

    return generatedValue ? `${name}=${generatedValue}` : line;
  })
  .join('\n');

writeFileSync(targetPath, `${environment.trimEnd()}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
});

console.log('Created .env.staging with new local-only random secrets.');
console.log('Development accounts use OTP 111111:');
console.log('  passenger: +79990000001');
console.log('  driver:    +79990000002');
console.log('  admin:     +79990000000');

function randomSecret() {
  return randomBytes(32).toString('hex');
}
