import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DeviceTokenController } from './device-token.controller.js';
import type { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';

class FakeDeviceTokenService {
  readonly registerCalls: unknown[] = [];
  readonly refreshCalls: unknown[] = [];
  readonly revokeCalls: Array<{ userId: string; id: string }> = [];
  readonly listCalls: string[] = [];

  async registerDevice(input: unknown) {
    this.registerCalls.push(input);
    return { id: 'device-token-1', status: 'ACTIVE' };
  }

  async refreshDevice(input: unknown) {
    this.refreshCalls.push(input);
    return { id: 'device-token-2', status: 'ACTIVE' };
  }

  async revokeDevice(userId: string, id: string) {
    this.revokeCalls.push({ userId, id });
  }

  async listDevices(userId: string) {
    this.listCalls.push(userId);
    return [{ id: 'device-token-1', status: 'ACTIVE' }];
  }
}

class FakeRateLimit {
  readonly checkedUserIds: string[] = [];
  shouldThrow = false;

  async checkRegisterDevice(userId: string) {
    this.checkedUserIds.push(userId);
    if (this.shouldThrow) throw new Error('rate limited');
  }
}

function buildController() {
  const deviceTokenService = new FakeDeviceTokenService();
  const rateLimit = new FakeRateLimit();
  const controller = new DeviceTokenController(
    deviceTokenService as never,
    rateLimit as never,
  );
  return { controller, deviceTokenService, rateLimit };
}

const passenger: AuthenticatedUser = {
  id: 'user-1',
  phone: '+79995551234',
  role: 'PASSENGER',
  sessionId: 'session-1',
};

const driver: AuthenticatedUser = {
  id: 'user-2',
  phone: '+79995551235',
  role: 'DRIVER',
  sessionId: 'session-2',
};

const registerInput: RegisterDeviceTokenDto = {
  deviceId: 'device-1',
  platform: 'ANDROID',
  pushToken: 'a'.repeat(64),
  notificationsPermission: true,
};

describe('DeviceTokenController', () => {
  it('derives application from the authenticated role rather than any client field', async () => {
    const { controller, deviceTokenService } = buildController();

    await controller.register(passenger, registerInput);
    await controller.register(driver, registerInput);

    expect(deviceTokenService.registerCalls[0]).toMatchObject({
      userId: 'user-1',
      application: 'PASSENGER',
    });
    expect(deviceTokenService.registerCalls[1]).toMatchObject({
      userId: 'user-2',
      application: 'DRIVER',
    });
  });

  it('always uses the session id from the authenticated user, never a client-supplied value', async () => {
    const { controller, deviceTokenService } = buildController();

    await controller.register(passenger, registerInput);

    expect(deviceTokenService.registerCalls[0]).toMatchObject({
      deviceSessionId: 'session-1',
    });
  });

  it('checks the rate limiter before registering', async () => {
    const { controller, deviceTokenService, rateLimit } = buildController();
    rateLimit.shouldThrow = true;

    await expect(controller.register(passenger, registerInput)).rejects.toThrow(
      'rate limited',
    );
    expect(deviceTokenService.registerCalls).toHaveLength(0);
  });

  it('refresh also derives application from role and is rate-limited', async () => {
    const { controller, deviceTokenService, rateLimit } = buildController();

    await controller.refresh(driver, registerInput);

    expect(rateLimit.checkedUserIds).toEqual(['user-2']);
    expect(deviceTokenService.refreshCalls[0]).toMatchObject({
      application: 'DRIVER',
    });
  });

  it('revoke delegates to the service with the authenticated user id', async () => {
    const { controller, deviceTokenService } = buildController();

    const result = await controller.revoke(passenger, 'device-token-1');

    expect(result).toEqual({ status: 'ok' });
    expect(deviceTokenService.revokeCalls).toEqual([
      { userId: 'user-1', id: 'device-token-1' },
    ]);
  });

  it('list delegates to the service with the authenticated user id', async () => {
    const { controller, deviceTokenService } = buildController();

    const result = await controller.list(passenger);

    expect(result).toEqual([{ id: 'device-token-1', status: 'ACTIVE' }]);
    expect(deviceTokenService.listCalls).toEqual(['user-1']);
  });
});
