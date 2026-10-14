import { getCampus, inviteFor } from '@commitmates/core';
import { Card, Chip, CompanionSprite, hashSeed, speciesFor } from '@commitmates/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InviteButton } from '@/components/campus/InviteButton';
import { UnlockList } from '@/components/campus/UnlockList';
import { campusCopy } from '@/copy/campus';
import { brandCompanion } from '@/lib/brand';
import { siteUrl } from '@/lib/site';
import { getCurrentMember } from '@/server/auth';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const campus = await getCampus((await params).slug);
  return { title: campus ? campusCopy.meta.title(campus.university.name) : undefined, robots: { index: false } };
}

/**
 * A university's page (CLAUDE.md §9.6, §1.4): its verified members, what they build with, and the
 * campus features with their unlock progress. Members of the university get an invite link.
 */
export default async function UniversityPage({ params }: Props) {
  const campus = await getCampus((await params).slug);
  if (!campus) notFound();
  const member = await getCurrentMember();
  const invite = member ? await inviteFor(member, campus.university.id) : null;
  const link = invite ? `${siteUrl}/?ref=${encodeURIComponent(campus.university.slug)}&invite=${encodeURIComponent(invite.code)}` : null;
  const copy = campusCopy;
  // A university's companion is seeded by its id and wears the brand accent (CLAUDE.md §9.5).
  const companion = {
    ...brandCompanion,
    seed: hashSeed(campus.university.id),
    species: speciesFor(campus.university.slug),
    stage: 2,
  };

  return (
    <div className="mx-auto flex max-w-content flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-center gap-4">
        <CompanionSprite companion={companion} state="idle" size={96} />
        <div className="min-w-0">
          <p className="type-eyebrow text-fg-muted">{copy.eyebrow}</p>
          <h1 className="type-h1 break-words">{campus.university.name}</h1>
          <p className="type-body text-fg-muted">
            {campus.university.country} · {copy.members(campus.members)} · {copy.alumni(campus.alumni)}
          </p>
        </div>
      </header>

      <Card title={copy.topicsTitle} className="flex flex-col gap-3">
        {campus.topics.length === 0 ? (
          <p className="type-small text-fg-muted">{copy.topicsEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {campus.topics.map((topic) => (
              <li key={topic.topic}>
                <Chip>
                  <span aria-hidden="true">
                    {topic.topic} · {topic.members}
                  </span>
                  <span className="sr-only">{copy.topicsLabel(topic.topic, topic.members)}</span>
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section aria-labelledby="unlocks" className="flex flex-col gap-4">
        <div>
          <h2 id="unlocks" className="type-h2">
            {copy.unlocksTitle}
          </h2>
          <p className="type-body text-fg-muted">{copy.unlocksIntro}</p>
        </div>
        {link && invite ? (
          <Card className="flex flex-col gap-2">
            <InviteButton link={link} />
            <p className="type-small text-fg-muted">{copy.invite.uses(invite.uses)}</p>
          </Card>
        ) : (
          <p className="type-small text-fg-muted">{copy.invite.onlyMembers}</p>
        )}
        <UnlockList unlocks={campus.unlocks} />
      </section>
    </div>
  );
}
