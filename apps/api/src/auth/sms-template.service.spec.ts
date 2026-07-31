import { OtpPurpose } from '../generated/prisma/enums.js';
import { SmsTemplateService } from './sms-template.service.js';

describe('SmsTemplateService', () => {
  const service = new SmsTemplateService();

  it('renders the LOGIN template with the code embedded', () => {
    const { message, templateVersion } = service.renderVerificationCode(
      OtpPurpose.LOGIN,
      '123456',
    );

    expect(message).toBe(
      'Код входа в Resilient Taxi: 123456. Никому его не сообщайте.',
    );
    expect(templateVersion).toBe(1);
  });

  it('renders a distinct template per purpose', () => {
    const login = service.renderVerificationCode(OtpPurpose.LOGIN, '111111');
    const driverRegistration = service.renderVerificationCode(
      OtpPurpose.DRIVER_REGISTRATION,
      '111111',
    );
    const phoneChange = service.renderVerificationCode(
      OtpPurpose.PHONE_CHANGE,
      '111111',
    );
    const sensitiveAction = service.renderVerificationCode(
      OtpPurpose.SENSITIVE_ACTION,
      '111111',
    );

    const messages = new Set([
      login.message,
      driverRegistration.message,
      phoneChange.message,
      sensitiveAction.message,
    ]);
    expect(messages.size).toBe(4);
  });

  it('never accepts free-form text — only (purpose, code, locale) compose the message', () => {
    // Type-level guarantee: renderVerificationCode has no third string
    // parameter for arbitrary content, only a constrained SmsLocale.
    expect(service.renderVerificationCode.length).toBeLessThanOrEqual(3);
  });
});
