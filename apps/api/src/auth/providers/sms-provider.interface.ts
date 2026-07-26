export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  sendCode(phone: string, code: string): Promise<void>;
}
