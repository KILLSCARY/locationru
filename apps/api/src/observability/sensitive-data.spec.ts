import { redactSensitiveData } from './sensitive-data.js';

describe('redactSensitiveData', () => {
  it('redacts an OTP code field', () => {
    const result = redactSensitiveData({ code: '123456', tripId: 'trip-1' }) as Record<
      string,
      unknown
    >;
    expect(result.code).toBe('[REDACTED]');
    expect(result.tripId).toBe('trip-1');
  });

  it('redacts access and refresh tokens', () => {
    const result = redactSensitiveData({
      accessToken: 'abc.def.ghi',
      refreshToken: 'session.expiry.secret',
    }) as Record<string, unknown>;
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('redacts an Authorization header regardless of casing', () => {
    const result = redactSensitiveData({
      Authorization: 'Bearer abc123',
      authorization: 'Bearer abc123',
    }) as Record<string, unknown>;
    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.authorization).toBe('[REDACTED]');
  });

  it('redacts payment webhook secrets', () => {
    const result = redactSensitiveData({
      webhookSecret: 'super-secret-value',
    }) as Record<string, unknown>;
    expect(result.webhookSecret).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields at any depth', () => {
    const result = redactSensitiveData({
      request: { headers: { authorization: 'Bearer xyz' } },
    }) as Record<string, unknown>;
    const request = result.request as Record<string, unknown>;
    const headers = request.headers as Record<string, unknown>;
    expect(headers.authorization).toBe('[REDACTED]');
  });

  it('masks phone-number-shaped strings in free text', () => {
    const result = redactSensitiveData(
      'user +79995551234 requested a code',
    ) as string;
    expect(result).not.toContain('79995551234');
    expect(result).toContain('+7');
    expect(result).toContain('34');
  });

  it('leaves non-sensitive fields untouched', () => {
    const result = redactSensitiveData({
      tripId: 'trip-1',
      status: 'IN_PROGRESS',
      amountKopecks: 60_000,
    }) as Record<string, unknown>;
    expect(result).toEqual({
      tripId: 'trip-1',
      status: 'IN_PROGRESS',
      amountKopecks: 60_000,
    });
  });

  it('handles Error instances without leaking sensitive fields from other keys', () => {
    const result = redactSensitiveData({
      error: new Error('failed for +79995551234'),
    }) as Record<string, { message: string }>;
    expect(result.error.message).not.toContain('79995551234');
  });
});
