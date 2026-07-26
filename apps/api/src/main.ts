import { ConfigService } from '@nestjs/config';

import { createApplication } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('app.port');

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
