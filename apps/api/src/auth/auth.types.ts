export interface AccessTokenPayload {
  sub: string;
  sessionId: string;
  roles: Array<'PASSENGER' | 'DRIVER' | 'ADMIN'>;
}

export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  sessionId: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
