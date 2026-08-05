import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnvironment } from '@resilient-taxi/config';

/**
 * Every route in this module exists only in staging. Outside staging it
 * returns 404 (not 403) — a production/development caller must not even
 * learn the endpoint exists.
 */
@Injectable()
export class StagingOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    const environment =
      this.config.getOrThrow<AppEnvironment>('app.appEnvironment');
    if (environment !== AppEnvironment.STAGING) {
      throw new NotFoundException();
    }
    return true;
  }
}
