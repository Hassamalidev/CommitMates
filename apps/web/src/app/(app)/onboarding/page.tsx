import {
  findUniversities,
  getOnboardingOptions,
  getPendingVerification,
  getSetting,
  getUniversity,
  getVouchingStatus,
  latestUniversityRequest,
  listCountries,
} from '@commitmates/core';
import { Card, buttonStyles } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OnboardingDetails } from '@/components/onboarding/OnboardingDetails';
import { VerifyEmail } from '@/components/onboarding/VerifyEmail';
import { VouchPath } from '@/components/onboarding/VouchPath';
import { onboardingCopy } from '@/copy/onboarding';
import { siteUrl } from '@/lib/site';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: onboardingCopy.meta.title, robots: { index: false } };
}

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export default async function OnboardingPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q : '';
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/onboarding');
  const copy = onboardingCopy;
  const [university, pending, request, countries, vouching, vouchesRequired, results] = await Promise.all([
    member.verified && member.universityId ? getUniversity(member.universityId) : null,
    getPendingVerification(member.id),
    latestUniversityRequest(member.id),
    listCountries(),
    member.verified ? null : getVouchingStatus(member.id),
    getSetting('verify.vouchesRequired'),
    member.verified ? [] : findUniversities(query),
  ]);

  // Verified but not onboarded yet: the details step comes next (§8 F10 step 7).
  if (university && !member.onboarded) {
    const options = await getOnboardingOptions(member);
    const details = options.details;
    return (
      <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
        <h1 className="type-h1">{copy.details.title}</h1>
        <OnboardingDetails
          universityName={university.name}
          departments={options.departments}
          suggestions={options.suggestions}
          years={options.years}
          maxGoals={options.maxGoals}
          initial={{
            role: details?.role === 'alumni' || details?.role === 'supervisor_pending' ? details.role : 'student',
            gradYear: details?.gradYear ?? null,
            department: options.departments.find((department) => department.id === details?.departmentId)?.name ?? '',
            learningGoals: details?.learningGoals ?? [],
            visibility: details?.visibility ?? 'university',
            shareTodayStatus: details?.shareTodayStatus ?? true,
            emailDigest: details?.emailDigest ?? true,
            timezone: details?.timezone ?? 'UTC',
          }}
        />
      </div>
    );
  }

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
      {member.verified ? null : (
        <VouchPath
          status={vouching}
          required={vouchesRequired}
          query={query}
          results={results}
          profileUrl={member.login ? `${siteUrl}/u/${encodeURIComponent(member.login)}` : null}
        />
      )}
    </div>
  );
}
