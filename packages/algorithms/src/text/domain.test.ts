import { describe, expect, it } from 'vitest';

import { domainSuffixes, emailDomain, normalizeDomain } from './domain';

describe('normalizeDomain', () => {
  it('lowercases and trims, and rejects what is not a hostname', () => {
    expect(normalizeDomain(' CS.Uni.EDU. ')).toBe('cs.uni.edu');
    expect(normalizeDomain('xn--bcher-kva.de')).toBe('xn--bcher-kva.de');
    for (const bad of ['', 'edu', 'uni..edu', '-uni.edu', 'uni-.edu', 'uni edu.org', 'uni_edu.org', '.uni.edu']) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe('emailDomain', () => {
  it('takes the part after the last @', () => {
    expect(emailDomain('Ada.Lovelace@CS.Uni.edu')).toBe('cs.uni.edu');
    expect(emailDomain('"odd@name"@uni.edu')).toBe('uni.edu');
    for (const bad of ['ada', '@uni.edu', 'ada@', 'ada@edu']) expect(emailDomain(bad), bad).toBeNull();
  });
});

describe('domainSuffixes', () => {
  it('lists suffixes at label boundaries, longest first, never a bare top-level domain', () => {
    expect(domainSuffixes('mail.cs.uni.edu')).toEqual(['mail.cs.uni.edu', 'cs.uni.edu', 'uni.edu']);
    expect(domainSuffixes('uni.edu')).toEqual(['uni.edu']);
    expect(domainSuffixes('edu')).toEqual([]);
  });

  it('matches at label boundaries only: notuni.edu is not a suffix match for uni.edu', () => {
    expect(domainSuffixes('notuni.edu')).not.toContain('uni.edu');
    expect(domainSuffixes('cs.notuni.edu')).toEqual(['cs.notuni.edu', 'notuni.edu']);
  });
});
