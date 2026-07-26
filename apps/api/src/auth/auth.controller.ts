import {
  Body,
  Controller,
  Get,
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

import { AuthService } from './auth.service.js';
import type { AuthenticatedUser, AuthTokens } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RequestCodeDto } from './dto/request-code.dto.js';
import { VerifyCodeDto } from './dto/verify-code.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('request-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request an OTP code' })
  requestCode(@Body() input: RequestCodeDto): Promise<{ status: 'accepted' }> {
    return this.authService.requestCode(input.phone);
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and create a device session' })
  verifyCode(@Body() input: VerifyCodeDto): Promise<AuthTokens> {
    return this.authService.verifyCode(input);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body() input: RefreshTokenDto): Promise<AuthTokens> {
    return this.authService.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current device session' })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<{ status: 'ok' }> {
    return this.authService.logout(user);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiOkResponse({ description: 'Current authenticated user' })
  getMe(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return this.authService.getMe(user);
  }
}
