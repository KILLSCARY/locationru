import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { PricingEstimateRequestDto } from './dto/pricing-estimate.dto.js';
import { toRouteRequest } from './dto/route-request.mapper.js';
import { MapsService } from './maps.service.js';
import type { PricingEstimate } from './maps.types.js';
import { PricingEstimateService } from './pricing/pricing-estimate.service.js';

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricing: PricingEstimateService,
    private readonly mapsService: MapsService,
  ) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recommend a fare range for a trip' })
  @ApiOkResponse({ description: 'Recommended price range (a suggestion)' })
  async estimate(
    @Body() body: PricingEstimateRequestDto,
  ): Promise<PricingEstimate> {
    let { distanceMeters, durationSeconds } = body;

    if (distanceMeters === undefined || durationSeconds === undefined) {
      if (!body.route) {
        throw new BadRequestException({
          code: 'DISTANCE_OR_ROUTE_REQUIRED',
          message:
            'Provide distanceMeters and durationSeconds, or a route to estimate them',
        });
      }
      const route = await this.mapsService.estimateRoute(
        toRouteRequest(body.route),
      );
      distanceMeters = route.distanceMeters;
      durationSeconds = route.durationSeconds;
    }

    return this.pricing.estimate(distanceMeters, durationSeconds);
  }
}
