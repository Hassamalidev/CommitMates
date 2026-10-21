import { getModerationQueue, getSetting, hasRole, listDisputes } from '@commitmates/core';
import { Card, EmptyState, Input, Textarea } from '@commitmates/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReportGroupCard } from '@/components/admin/ReportGroupCard';
import { ActionForm } from '@/components/forms/ActionForm';
import { adminCopy } from '@/copy/admin';
import { adjustCreditsAction, resolveDisputeAction } from '@/server/actions/reviews';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: adminCopy.moderation.metaTitle, robots: { index: false } };
}

/**
 * The moderation queue (CLAUDE.md §8 F12 "Moderation queue", §5.11): open reports grouped by the
 * reported member; admins see everything, moderators only members of their universities.
 */
export default async function AdminModerationPage() {
  const member = await getCurrentMember();
  if (member?.status !== 'active') notFound();
  const queue = await getModerationQueue(member).catch(() => null);
  if (!queue) notFound();
  const [maxDays, disputes] = await Promise.all([getSetting('safety.maxSuspensionDays'), listDisputes(member)]);
  const isAdmin = hasRole(member, 'admin');
  const copy = adminCopy.moderation;
  const { scope, groups } = queue;

  return (
    <>
      <h1 className="type-h1">{copy.title}</h1>
      <p className="type-body mt-2 max-w-reading text-fg-muted">
        {scope.admin ? copy.scopeAdmin : copy.scopeModerator(scope.universities.map((university) => university.name).join(', '))} {copy.intro}
      </p>
      <section aria-labelledby="queue-title" className="mt-6 flex flex-col gap-4">
        <h2 id="queue-title" className="type-h2">
          {copy.queueTitle}
        </h2>
        {groups.length === 0 ? (
          <Card>
            <EmptyState title={copy.queueTitle} description={copy.queueEmpty} />
          </Card>
        ) : (
          groups.map((group) => (
            <ReportGroupCard
              key={group.targetUserId}
              maxDays={maxDays}
              canActOnAdmins={hasRole(member, 'admin')}
              group={{
                targetUserId: group.targetUserId,
                login: group.login,
                name: group.name,
                status: group.status,
                universityName: group.universityName,
                isAdmin: group.isAdmin,
                reports: group.reports.map((report) => ({
                  id: report.id,
                  reason: report.reason,
                  details: report.details,
                  reporterLogin: report.reporterLogin,
                  hasMessage: report.targetMessage !== null,
                  createdAt: report.createdAt.toISOString(),
                })),
              }}
            />
          ))
        )}
      </section>

      <section aria-labelledby="disputes-title" className="mt-8 flex flex-col gap-4">
        <h2 id="disputes-title" className="type-h2">
          {copy.disputes.title}
        </h2>
        <p className="type-small max-w-reading text-fg-muted">{copy.disputes.intro}</p>
        {disputes.length === 0 ? (
          <Card>
            <EmptyState title={copy.disputes.title} description={copy.disputes.empty} />
          </Card>
        ) : (
          disputes.map((dispute) => {
            const name = copy.disputes.pr(dispute.repoFullName, dispute.prNumber);
            return (
              <Card key={dispute.id} as="article" aria-label={name} className="flex flex-col gap-2">
                <a href={dispute.prUrl} rel="noopener noreferrer" target="_blank" className="type-body font-semibold break-all underline">
                  {name}
                </a>
                <p className="type-small">{copy.disputes.people(dispute.claimerLogin, dispute.authorLogin)}</p>
                {dispute.review ? <p className="type-small text-fg-muted">{copy.disputes.comments(dispute.review.lineComments)}</p> : null}
                {dispute.disputeNote ? <p className="type-small break-words">{copy.disputes.note(dispute.disputeNote)}</p> : null}
                <ActionForm action={resolveDisputeAction} values={{ requestId: dispute.id }} submitLabel={copy.disputes.submit} successMessage={copy.disputes.done} className="flex flex-col items-start gap-2">
                  <fieldset className="flex flex-col gap-1">
                    <legend className="type-small mb-1 font-semibold">{copy.disputes.legend(name)}</legend>
                    {(['reviewer', 'author'] as const).map((outcome, index) => (
                      <label key={outcome} className="type-small flex min-h-11 items-center gap-2">
                        <input type="radio" name="outcome" value={outcome} defaultChecked={index === 0} required />
                        {copy.disputes.outcomes[outcome]}
                      </label>
                    ))}
                  </fieldset>
                  <Textarea label={copy.disputes.decisionNote} name="note" rows={2} maxLength={500} />
                </ActionForm>
              </Card>
            );
          })
        )}
      </section>

      {isAdmin ? (
        <section aria-labelledby="credits-title" className="mt-8 flex max-w-reading flex-col gap-3">
          <h2 id="credits-title" className="type-h2">
            {copy.credits.title}
          </h2>
          <p className="type-small text-fg-muted">{copy.credits.intro}</p>
          <Card>
            <ActionForm action={adjustCreditsAction} submitLabel={copy.credits.submit} successMessage={copy.credits.done} className="flex flex-col items-start gap-3">
              <Input label={copy.credits.login} name="login" required />
              <Input label={copy.credits.delta} name="delta" type="number" step={1} required />
              <Input label={copy.credits.note} name="note" required />
            </ActionForm>
          </Card>
        </section>
      ) : null}
    </>
  );
}
