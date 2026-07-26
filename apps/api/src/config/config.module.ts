import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import configuration from './configuration.js';
import { environmentValidationSchema } from './env.validation.js';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      expandVariables: true,
      isGlobal: true,
      load: [configuration],
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
      validationSchema: environmentValidationSchema,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
