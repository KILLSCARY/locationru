import { BadRequestException } from '@nestjs/common';

/** Trims, collapses internal whitespace, and rejects empty/HTML-bearing values — used for every free-text profile field (firstName/lastName/middleName). */
export function normalizeName(raw: string, fieldLabel: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    throw new BadRequestException({
      code: 'EMPTY_PROFILE_FIELD',
      message: `${fieldLabel} cannot be empty`,
    });
  }
  if (/[<>]/.test(trimmed)) {
    throw new BadRequestException({
      code: 'INVALID_PROFILE_FIELD',
      message: `${fieldLabel} contains disallowed characters`,
    });
  }
  return trimmed;
}
