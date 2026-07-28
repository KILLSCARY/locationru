import { NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HttpSmsProvider } from './http-sms.provider.js';

describe('HttpSmsProvider', () => {
  const provider = new HttpSmsProvider(
    new ConfigService({
      sms: {
        apiBaseUrl: 'https://gateway.example/v1/',
        apiKey: 'test-key',
        sender: 'ResilientTaxi',
        requestTimeoutMs: 10_000,
      },
    }),
  );

  it('refuses to send until a gateway is wired in', async () => {
    await expect(
      provider.sendCode('+79990000000', '123456'),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });
});
