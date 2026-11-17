import { describe, expect, it } from 'vitest';
import { countryCode, countryOf } from './country';

describe('countryCode', () => {
  it('maps dialling codes', () => {
    expect(countryCode('996771002840')).toBe('KG');
    expect(countryCode('12402550596')).toBe('US');
    expect(countryCode('77011234567')).toBe('KZ');
    expect(countryCode('79161234567')).toBe('RU');
    expect(countryCode('971501234567')).toBe('AE');
    expect(countryCode('+44 7700 900123')).toBe('GB');
  });
  it('returns null for unknown or empty', () => {
    expect(countryCode('')).toBeNull();
    expect(countryCode('0000')).toBeNull();
    expect(countryOf('999000')).toBeNull();
  });
  it('gives a flag', () => { expect(countryOf('996771002840')?.flag).toBe('🇰🇬'); });
});
