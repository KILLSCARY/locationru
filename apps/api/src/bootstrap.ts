import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { RequestIdMiddleware } from './observability/request-id.middleware.js';
import { RequestLoggingInterceptor } from './observability/request-logging.interceptor.js';

export async function createApplication(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({
      json: true,
      colors: false,
    }),
  });

  const configService = app.get(ConfigService);

  app.useBodyParser('json', {
    limit: configService.getOrThrow<number>('app.bodyLimitBytes'),
  });
  app.setGlobalPrefix('api/v1');
  app.use(new RequestIdMiddleware().use);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(app.get(RequestLoggingInterceptor));
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();

  // Never "*"; empty means no browser client needs cross-origin access in
  // this environment (e.g. local dev, where admin-web proxies through its
  // own Next.js server rather than calling the API cross-origin).
  const corsOrigins = configService.getOrThrow<string[]>('cors.allowedOrigins');
  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    });
  }

  if (configService.getOrThrow<boolean>('app.enableSwagger')) {
    const publicUrl = configService.get<string>('app.publicUrl');
    const swaggerConfigBuilder = new DocumentBuilder()
      .setTitle('Resilient Taxi API')
      .setDescription('Resilient Taxi HTTP API')
      .setVersion('1.0');
    if (publicUrl) swaggerConfigBuilder.addServer(publicUrl);
    const document = SwaggerModule.createDocument(
      app,
      swaggerConfigBuilder.build(),
    );

    SwaggerModule.setup('docs', app, document);
  }

  return app;
}
