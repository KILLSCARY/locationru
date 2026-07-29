import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
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
import { AddressSuggestionsQueryDto } from './dto/address-suggestions.dto.js';
import { GeocodeRequestDto } from './dto/geocode.dto.js';
import { ReverseGeocodeRequestDto } from './dto/reverse-geocode.dto.js';
import { isSearchableQuery } from './geo/address-normalizer.js';
import { MapsRateLimitService } from './maps-rate-limit.service.js';
import { MapsService } from './maps.service.js';
import type {
  AddressSuggestion,
  GeoPoint,
  ResolvedAddress,
} from './maps.types.js';

@ApiTags('maps')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('maps')
export class MapsController {
  private readonly suggestionsRateLimit: number;

  constructor(
    private readonly mapsService: MapsService,
    private readonly rateLimit: MapsRateLimitService,
    configService: ConfigService,
  ) {
    this.suggestionsRateLimit = configService.getOrThrow<number>(
      'maps.suggestionsRateLimitPerMinute',
    );
  }

  @Get('address-suggestions')
  @ApiOperation({ summary: 'Search address suggestions for a text query' })
  @ApiOkResponse({ description: 'Ranked address suggestions' })
  async addressSuggestions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AddressSuggestionsQueryDto,
  ): Promise<{ suggestions: AddressSuggestion[]; provider: string }> {
    await this.rateLimit.enforce(
      'suggestions',
      user.id,
      this.suggestionsRateLimit,
    );

    if (!isSearchableQuery(query.query)) {
      throw new BadRequestException({
        code: 'QUERY_TOO_SHORT',
        message: 'Search query must contain at least 3 meaningful characters',
      });
    }

    const bias = this.parseBias(query.latitude, query.longitude);
    const suggestions = await this.mapsService.searchAddress({
      query: query.query,
      bias,
      limit: Math.min(query.limit ?? 5, 10),
    });

    return { suggestions, provider: this.mapsService.providerName };
  }

  @Post('geocode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a free-text address to coordinates' })
  @ApiOkResponse({ description: 'Resolved address' })
  async geocode(
    @Body() body: GeocodeRequestDto,
  ): Promise<{ address: ResolvedAddress }> {
    const resolved = await this.mapsService.geocode(body.address);
    if (!resolved) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Address could not be resolved',
      });
    }
    return { address: resolved };
  }

  @Post('reverse-geocode')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve coordinates to the nearest address' })
  @ApiOkResponse({ description: 'Resolved address' })
  async reverseGeocode(
    @Body() body: ReverseGeocodeRequestDto,
  ): Promise<{ address: ResolvedAddress }> {
    const resolved = await this.mapsService.reverseGeocode(
      body.latitude,
      body.longitude,
    );
    if (!resolved) {
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'No address found near the given coordinates',
      });
    }
    return { address: resolved };
  }

  private parseBias(
    latitude: number | undefined,
    longitude: number | undefined,
  ): GeoPoint | undefined {
    if (latitude === undefined && longitude === undefined) {
      return undefined;
    }
    if (latitude === undefined || longitude === undefined) {
      throw new BadRequestException({
        code: 'INCOMPLETE_BIAS',
        message: 'Both latitude and longitude are required to bias search',
      });
    }
    return { latitude, longitude };
  }
}
