import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class PhoneNormalizer {
  normalize(input: string): string {
    const trimmed = input.trim();
    const hasInternationalPrefix = trimmed.startsWith('+');
    let digits = trimmed.replace(/\D/g, '');

    if (!hasInternationalPrefix) {
      if (digits.length === 11 && digits.startsWith('8')) {
        digits = `7${digits.slice(1)}`;
      } else if (digits.length === 10) {
        digits = `7${digits}`;
      }
    }

    const normalized = `+${digits}`;

    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Phone number is invalid',
      });
    }

    return normalized;
  }
}
