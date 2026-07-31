import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { AuthService, type RequestContext } from './auth.service.js';
import type {
  AuthenticatedUser,
  AuthTokens,
  SessionSummary,
} from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RequestCodeDto } from './dto/request-code.dto.js';
import { ResendCodeDto } from './dto/resend-code.dto.js';
import { VerifyCodeDto } from './dto/verify-code.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import type { OtpRequestSummary } from './otp.service.js';
import type { AvailableChannel } from './auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('request-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request an OTP code' })
  requestCode(
    @Body() input: RequestCodeDto,
    @Req() request: Request,
  ): Promise<OtpRequestSummary> {
    return this.authService.requestCode({
      phone: input.phone,
      deviceId: input.deviceId,
      ...this.requestContext(request),
    });
  }

  @Post('resend-code')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Resend an OTP code for an existing request' })
  resendCode(
    @Body() input: ResendCodeDto,
    @Req() request: Request,
  ): Promise<OtpRequestSummary> {
    return this.authService.resendCode({
      requestId: input.requestId,
      phone: input.phone,
      deviceId: input.deviceId,
      ...this.requestContext(request),
    });
  }

  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and create a device session' })
  verifyCode(
    @Body() input: VerifyCodeDto,
    @Req() request: Request,
  ): Promise<AuthTokens> {
    return this.authService.verifyCode({
      requestId: input.requestId,
      phone: input.phone,
      code: input.code,
      deviceId: input.deviceId,
      platform: input.platform,
      ...(input.appVersion !== undefined
        ? { appVersion: input.appVersion }
        : {}),
      ...this.requestContext(request),
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(
    @Body() input: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<AuthTokens> {
    return this.authService.refresh({
      refreshToken: input.refreshToken,
      ...this.requestContext(request),
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current device session' })
  logout(@CurrentUser() user: AuthenticatedUser): Promise<{ status: 'ok' }> {
    return this.authService.logout(user);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every device session for the current user' })
  logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<{ status: 'ok' }> {
    return this.authService.logoutAll(user);
  }

  @Get('sessions')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the current user active device sessions' })
  listSessions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SessionSummary[]> {
    return this.authService.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a single device session by id' })
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<{ status: 'ok' }> {
    return this.authService.revokeSessionForUser(user, sessionId);
  }

  @Get('channels')
  @ApiOperation({ summary: 'List available OTP delivery channels' })
  @ApiOkResponse({ description: 'Available verification channels' })
  getChannels(): { channels: AvailableChannel[] } {
    return this.authService.getChannels();
  }

  @Get('me')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiOkResponse({ description: 'Current authenticated user' })
  getMe(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return this.authService.getMe(user);
  }

  private requestContext(request: Request): RequestContext {
    const userAgent = request.headers['user-agent'];
    return {
      ip: request.ip ?? '',
      ...(userAgent ? { userAgent } : {}),
    };
  }
}
