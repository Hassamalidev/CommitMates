import { getPendingVerification, getUniversity, latestUniversityRequest, listCountries } from '@commitmates/core';
import { Card, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { VerifyEmail } from '@/components/onboarding/VerifyEmail';
import { onboardingCopy } from '@/copy/onboarding';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: onboardingCopy.meta.title, robots: { index: false } };
}

export default async function OnboardingPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/onboarding');
  const copy = onboardingCopy;
  const [university, pending, request, countries] = await Promise.all([
    member.verified && member.universityId ? getUniversity(member.universityId) : null,
    getPendingVerification(member.id),
    latestUniversityRequest(member.id),
    listCountries(),
  ]);

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="type-h1">{copy.title}</h1>
        <p className="type-body mt-2 text-fg-muted">{copy.intro}</p>
      </div>
      {university ? (
        <Card title={copy.verified.title} className="flex flex-col gap-4">
          <p className="type-body">{copy.verified.line(university.name)}</p>
          <Link href="/home" className={buttonStyles({ variant: 'primary', size: 'md', className: 'self-start' })}>
            {copy.verified.next}
          </Link>
        </Card>
      ) : null}
      {request && !university ? (
        <div role="status" className="type-body rounded-control border border-line bg-surface-2 p-3">
          <p>{copy.request.status[request.status](request.domain)}</p>
          {request.note ? <p className="type-small mt-1 text-fg-muted">{copy.request.note(request.note)}</p> : null}
        </div>
      ) : null}
      {/* A verified member may verify again at another university. */}
      <VerifyEmail
        pending={pending?.email && pending.universityName ? { email: pending.email, universityName: pending.universityName } : null}
        countries={countries}
      />
    </div>
  );
}
