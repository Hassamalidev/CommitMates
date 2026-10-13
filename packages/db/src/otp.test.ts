import { describe, expect, it } from 'vitest';

import { generateOtp, hashOtp, verifyOtp } from './otp';

const PEPPER = 'pepper-'.padEnd(40, 'p');

describe('one-time codes', () => {
  it('generates six digits, including leading zeros', () => {
    const codes = Array.from({ length: 500 }, () => generateOtp());
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(450);
  });

  it('verifies the right code only', () => {
    const hash = hashOtp('012345', PEPPER);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('012345');
    expect(verifyOtp('012345', hash, PEPPER)).toBe(true);
    expect(verifyOtp('012346', hash, PEPPER)).toBe(false);
    expect(verifyOtp('12345', hash, PEPPER)).toBe(false);
  });

  it('depends on the pepper', () => {
    const hash = hashOtp('012345', PEPPER);
    expect(verifyOtp('012345', hash, 'other-'.padEnd(40, 'o'))).toBe(false);
  });

  it('rejects a malformed stored hash', () => {
    expect(verifyOtp('012345', 'not-hex', PEPPER)).toBe(false);
    expect(verifyOtp('012345', '', PEPPER)).toBe(false);
  });
});
