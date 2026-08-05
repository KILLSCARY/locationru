import { Injectable } from '@nestjs/common';

import { OtpPurpose } from '../generated/prisma/enums.js';

export type SmsLocale = 'ru';

interface OtpTemplateDefinition {
  version: number;
  maxLength: number;
  render(code: string): string;
}

/**
 * Centralized, versioned templates — the only place OTP message text is
 * composed. Deliberately takes only (purpose, code, locale): there is no
 * parameter for arbitrary text, so a client request can never inject its
 * own copy into an SMS. `locale` exists now as the seam for future
 * languages (see docs/auth/otp-architecture.md) — only `ru` is implemented.
 */
const OTP_TEMPLATES: Record<
  SmsLocale,
  Record<OtpPurpose, OtpTemplateDefinition>
> = {
  ru: {
    [OtpPurpose.LOGIN]: {
      version: 1,
      maxLength: 160,
      render: (code) =>
        `Код входа в Resilient Taxi: ${code}. Никому его не сообщайте.`,
    },
    [OtpPurpose.DRIVER_REGISTRATION]: {
      version: 1,
      maxLength: 160,
      render: (code) =>
        `Код регистрации водителя Resilient Taxi: ${code}. Никому его не сообщайте.`,
    },
    [OtpPurpose.PHONE_CHANGE]: {
      version: 1,
      maxLength: 160,
      render: (code) =>
        `Код подтверждения смены номера Resilient Taxi: ${code}. Никому его не сообщайте.`,
    },
    [OtpPurpose.SENSITIVE_ACTION]: {
      version: 1,
      maxLength: 160,
      render: (code) =>
        `Код подтверждения действия Resilient Taxi: ${code}. Никому его не сообщайте.`,
    },
  },
};

export interface RenderedSmsTemplate {
  message: string;
  templateVersion: number;
}

@Injectable()
export class SmsTemplateService {
  renderVerificationCode(
    purpose: OtpPurpose,
    code: string,
    locale: SmsLocale = 'ru',
  ): RenderedSmsTemplate {
    const template = OTP_TEMPLATES[locale][purpose];
    const message = template.render(code);

    if (message.length > template.maxLength) {
      throw new Error(
        `Rendered SMS template for ${purpose} exceeds maxLength (${template.maxLength})`,
      );
    }

    return { message, templateVersion: template.version };
  }
}
