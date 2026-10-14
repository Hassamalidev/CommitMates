import { domainSuffixes, emailDomain } from '@commitmates/algorithms';
import { findUniversitiesByDomainSuffixes, isDisposableDomain, type UniversityMatch } from '@commitmates/db';

export type EmailUniversityCheck =
  | { status: 'invalid' }
  | { status: 'disposable'; domain: string }
  | { status: 'unknown'; domain: string }
  | { status: 'matched'; domain: string; universities: UniversityMatch[] };

/**
 * Which university an email address belongs to (CLAUDE.md §8 F10 step 2): disposable
 * domains and their subdomains are rejected; otherwise the longest registered suffix at a
 * label boundary wins, so `name@cs.uni.edu` matches `uni.edu` and `notuni.edu` does not.
 * Several matches mean universities share the domain, and the member chooses.
 */
export async function matchEmailToUniversity(email: string): Promise<EmailUniversityCheck> {
  const domain = emailDomain(email);
  if (domain === null) return { status: 'invalid' };
  const suffixes = domainSuffixes(domain);
  if (await isDisposableDomain(suffixes)) return { status: 'disposable', domain };
  const matches = await findUniversitiesByDomainSuffixes(suffixes);
  return matches.length === 0 ? { status: 'unknown', domain } : { status: 'matched', domain, universities: matches };
}
