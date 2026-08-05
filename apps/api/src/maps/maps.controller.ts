import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AddressSuggestionsResponseSchema,
  AddressSuggestionsRequestSchema,
  GeocodeAddressRequestSchema,
  PricingEstimateSchema,
  ResolvedAddressResponseSchema,
  ReverseGeocodeRequestSchema,
  RouteRequestSchema,
  RouteResultSchema,
} from '@resilient-taxi/contracts';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  AddressSuggestionsQueryDto,
  GeocodeAddressDto,
  GeoPointDto,
  RouteRequestDto,
} from './dto/maps.dto.js';
import { MapsRateLimitGuard } from './maps-rate-limit.guard.js';
import { MapsService } from './maps.service.js';
import { PricingEstimateService } from './pricing-estimate.service.js';

@ApiTags('maps')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, MapsRateLimitGuard)
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get('address-suggestions')
  @ApiOperation({ summary: 'Search normalized address suggestions' })
  async suggestions(@Query() query: AddressSuggestionsQueryDto) {
    const validated = AddressSuggestionsRequestSchema.parse(query);
    const bias =
      validated.latitude === undefined || validated.longitude === undefined
        ? undefined
        : {
            latitude: validated.latitude,
            longitude: validated.longitude,
          };
    return AddressSuggestionsResponseSchema.parse({
      suggestions: await this.maps.searchAddress(
        validated.query,
        bias,
        validated.limit,
      ),
    });
  }

  @Post('geocode')
  @ApiOperation({ summary: 'Resolve an address to coordinates' })
  async geocode(@Body() input: GeocodeAddressDto) {
    const validated = GeocodeAddressRequestSchema.parse(input);
    return ResolvedAddressResponseSchema.parse({
      address: await this.maps.geocodeAddress(
        validated.address,
        validated.providerPlaceId,
      ),
    });
  }

  @Post('reverse-geocode')
  @ApiOperation({ summary: 'Resolve coordinates to an address' })
  async reverseGeocode(@Body() input: GeoPointDto) {
    const validated = ReverseGeocodeRequestSchema.parse(input);
    return ResolvedAddressResponseSchema.parse({
      address: await this.maps.reverseGeocode(validated),
    });
  }
}

@ApiTags('routes')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, MapsRateLimitGuard)
@Controller('routes')
export class RoutesController {
  constructor(private readonly maps: MapsService) {}

  @Post('estimate')
  @ApiOperation({ summary: 'Estimate route distance and duration' })
  async estimate(@Body() input: RouteRequestDto) {
    const request = RouteRequestSchema.parse(input);
    return RouteResultSchema.parse(await this.maps.estimateRoute(request));
  }

  @Post('build')
  @ApiOperation({ summary: 'Build a route with provider-neutral geometry' })
  async build(@Body() input: RouteRequestDto) {
    const request = RouteRequestSchema.parse(input);
    return RouteResultSchema.parse(await this.maps.buildRoute(request));
  }
}

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard, MapsRateLimitGuard)
@Roles('PASSENGER')
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly maps: MapsService,
    private readonly pricing: PricingEstimateService,
  ) {}

  @Post('estimate')
  @ApiOperation({ summary: 'Calculate a recommended passenger price range' })
  async estimate(@Body() input: RouteRequestDto) {
    const route = await this.maps.estimateRoute(
      RouteRequestSchema.parse(input),
    );
    return PricingEstimateSchema.parse(
      this.pricing.calculate(route.distanceMeters, route.durationSeconds),
    );
  }
}
