import { developersLikeYou, type Member } from '@commitmates/core';
import { Avatar, Card, CompanionSprite, hashSeed } from '@commitmates/ui';

import { discoverCopy } from '@/copy/discover';
import { brandCompanion } from '@/lib/brand';

/**
 * "Developers like you on GitHub" (CLAUDE.md §8 F11 "UI"): view-only links to public GitHub profiles,
 * shown before matching opens or before the first deck. These people are not members, so there is
 * no chat and no page of ours about them.
 */
export async function DevelopersLikeYou({ member }: { member: Member }) {
  const result = await developersLikeYou(member);
  const copy = discoverCopy.similar;
  return (
    <Card title={copy.title} titleAs="h2" className="flex flex-col gap-3">
      {result.status === 'no-language' ? <p className="type-body text-fg-muted">{copy.noLanguage}</p> : null}
      {result.status === 'unavailable' ? <p className="type-body text-fg-muted">{copy.unavailable}</p> : null}
      {result.status === 'ok' ? (
        <>
          <p className="type-small text-fg-muted">{copy.line(result.language, result.country)}</p>
          {result.people.length === 0 ? (
            <p className="type-body text-fg-muted">{copy.empty}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {result.people.map((person) => (
                <li key={person.githubId}>
                  <a
                    href={`https://github.com/${encodeURIComponent(person.login)}`}
                    rel="noopener noreferrer"
                    target="_blank"
                    aria-label={copy.open(person.login)}
                    className="flex min-h-11 items-center gap-3 rounded-control px-2 py-1 hover:bg-surface-2"
                  >
                    <Avatar
                      src={person.avatarUrl}
                      alt=""
                      size={32}
                      fallback={<CompanionSprite companion={{ ...brandCompanion, seed: hashSeed(person.login) }} state="idle" size={64} className="size-8" />}
                    />
                    <span className="type-small min-w-0 break-words">@{person.login}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </Card>
  );
}
