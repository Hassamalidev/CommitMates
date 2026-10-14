import { describe, expect, it } from 'vitest';

const { secretsMatch } = await import('./secrets');

describe('secretsMatch', () => {
  it('accepts the exact secret only', () => {
    expect(secretsMatch('s3cret-value', 's3cret-value')).toBe(true);
    expect(secretsMatch('s3cret-valuE', 's3cret-value')).toBe(false);
    expect(secretsMatch('s3cret', 's3cret-value')).toBe(false);
  });

  it('rejects missing values', () => {
    expect(secretsMatch(null, 'x')).toBe(false);
    expect(secretsMatch(undefined, 'x')).toBe(false);
    expect(secretsMatch('', 'x')).toBe(false);
  });
});
