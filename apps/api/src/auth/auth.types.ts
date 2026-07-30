export interface AccessTokenPayload {
  sub: string;
  sessionId: string;
  roles: Array<'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN'>;
}

export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN';
  sessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
