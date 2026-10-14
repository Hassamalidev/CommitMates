import { useTestDatabase, type TestDatabase } from '@commitmates/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { matchEmailToUniversity } from './service';

let database: TestDatabase;

async function university(name: string, slug: string, domains: string[]): Promise<void> {
  const [row] = await database.sql<{ id: string }[]>`
    insert into universities (name, slug, country, country_code, web_pages, source, source_key, checksum)
    values (${name}, ${slug}, 'Testland', 'TL', '{}', 'hipo', ${`TL:${slug}`}, 'x') returning id`;
  for (const domain of domains) await database.sql`insert into university_domains (domain, university_id) values (${domain}, ${row!.id})`;
}

beforeAll(async () => {
  database = await useTestDatabase();
  await university('Uni', 'uni-tl', ['uni.edu']);
  await university('Uni Medical School', 'uni-med-tl', ['med.uni.edu']);
  await university('Campus One', 'campus-one-tl', ['shared.edu']);
  await university('Campus Two', 'campus-two-tl', ['shared.edu']);
  await database.sql`insert into disposable_domains (domain, synced_at) values ('mailinator.com', now()), ('uni.edu.disposable.example', now())`;
});
afterAll(async () => {
  await database.destroy();
});

const names = async (email: string) => {
  const check = await matchEmailToUniversity(email);
  return check.status === 'matched' ? check.universities.map((match) => match.name) : check.status;
};

describe('matchEmailToUniversity', () => {
  it('matches subdomains to the registered root domain', async () => {
    expect(await names('ada@uni.edu')).toEqual(['Uni']);
    expect(await names('Ada@CS.Uni.EDU')).toEqual(['Uni']);
  });

  it('prefers the longest registered suffix', async () => {
    expect(await names('ada@med.uni.edu')).toEqual(['Uni Medical School']);
    expect(await names('ada@lab.med.uni.edu')).toEqual(['Uni Medical School']);
  });

  it('matches at label boundaries only', async () => {
    expect(await names('ada@notuni.edu')).toBe('unknown');
    expect(await names('ada@uni.edu.evil.com')).toBe('unknown');
  });

  it('returns every university that shares a domain, so the member can choose', async () => {
    expect(await names('ada@shared.edu')).toEqual(['Campus One', 'Campus Two']);
  });

  it('rejects disposable domains and their subdomains, and malformed addresses', async () => {
    expect(await matchEmailToUniversity('ada@mailinator.com')).toEqual({ status: 'disposable', domain: 'mailinator.com' });
    expect(await names('ada@inbox.mailinator.com')).toBe('disposable');
    expect(await names('ada@uni.edu.disposable.example')).toBe('disposable');
    for (const bad of ['ada', 'ada@', 'ada@edu']) expect(await names(bad), bad).toBe('invalid');
  });
});
