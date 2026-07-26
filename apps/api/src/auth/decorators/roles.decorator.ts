import { SetMetadata } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth.types.js';

export const AUTH_ROLES_KEY = 'auth.roles';
export type AuthRole = AuthenticatedUser['role'];

export const Roles = (...roles: AuthRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_ROLES_KEY, roles);
