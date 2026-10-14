import { getPendingVerification, getUniversity } from '@commitmates/core';
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
  const [university, pending] = await Promise.all([
    member.verified && member.universityId ? getUniversity(member.universityId) : null,
    getPendingVerification(member.id),
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
      {/* A verified member may verify again at another university. */}
      <VerifyEmail
        pending={pending?.email && pending.universityName ? { email: pending.email, universityName: pending.universityName } : null}
      />
    </div>
  );
}
