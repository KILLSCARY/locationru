import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RouteRequestDto } from './dto/route-request.dto.js';
import { toRouteRequest } from './dto/route-request.mapper.js';
import { MapsRateLimitService } from './maps-rate-limit.service.js';
import { MapsService } from './maps.service.js';
import type { GeoBounds, RouteResult } from './maps.types.js';

@ApiTags('routes')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('routes')
export class RoutesController {
  private readonly routesRateLimit: number;

  constructor(
    private readonly mapsService: MapsService,
    private readonly rateLimit: MapsRateLimitService,
    configService: ConfigService,
  ) {
    this.routesRateLimit = configService.getOrThrow<number>(
      'maps.routesRateLimitPerMinute',
    );
  }

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Estimate distance and duration for a route' })
  @ApiOkResponse({ description: 'Route estimate (no full geometry)' })
  async estimate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RouteRequestDto,
  ): Promise<{
    distanceMeters: number;
    durationSeconds: number;
    bounds: GeoBounds;
    provider: string;
  }> {
    await this.rateLimit.enforce('routes', user.id, this.routesRateLimit);
    const result = await this.mapsService.estimateRoute(toRouteRequest(body));
    return {
      distanceMeters: result.distanceMeters,
      durationSeconds: result.durationSeconds,
      bounds: result.bounds,
      provider: result.provider,
    };
  }

  @Post('build')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Build a full route with geometry' })
  @ApiOkResponse({ description: 'Route with geometry and bounds' })
  async build(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RouteRequestDto,
  ): Promise<{ route: RouteResult }> {
    await this.rateLimit.enforce('routes', user.id, this.routesRateLimit);
    const route = await this.mapsService.buildRoute(toRouteRequest(body));
    return { route };
  }
}
