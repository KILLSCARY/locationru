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

export interface SessionSummary {
  id: string;
  deviceId: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  appVersion: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  isCurrent: boolean;
}
