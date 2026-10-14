import { deletionConfirmation, getProfileDetails } from '@commitmates/core';
import { Card, Input } from '@commitmates/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ActionForm } from '@/components/forms/ActionForm';
import { privacyCenterCopy } from '@/copy/privacy-center';
import { deleteAccountAction, updatePrivacyAction } from '@/server/actions/privacy';
import { getCurrentMember } from '@/server/auth';

export function generateMetadata(): Metadata {
  return { title: privacyCenterCopy.meta.title, robots: { index: false } };
}

type Visibility = keyof typeof privacyCenterCopy.visibility.options;

/** The privacy center (CLAUDE.md §5.12, §2.6): visibility, ghost mode, export and account deletion. */
export default async function PrivacyPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/auth/sign-in?next=/settings/privacy');
  const details = await getProfileDetails(member.id);
  const ghost = details?.ghostMode ?? false;
  const copy = privacyCenterCopy;
  const visibility: Visibility = details?.visibility ?? 'university';
  const phrase = deletionConfirmation(member);

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="type-h1">{copy.title}</h1>
        <p className="type-body mt-2 text-fg-muted">{copy.intro}</p>
      </div>

      <Card title={copy.visibility.title}>
        <ActionForm
          action={updatePrivacyAction}
          submitLabel={copy.visibility.save}
          successMessage={copy.visibility.saved}
          variant="primary"
          size="md"
          className="flex flex-col gap-4"
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="type-small mb-1 font-semibold">{copy.visibility.legend}</legend>
            {(Object.keys(copy.visibility.options) as Visibility[]).map((option) => (
              <label key={option} className="type-body flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  value={option}
                  defaultChecked={option === visibility}
                  className="size-4 accent-accent"
                />
                {copy.visibility.options[option]}
              </label>
            ))}
          </fieldset>
          <label className="type-body flex min-h-11 items-center gap-2">
            <input type="checkbox" name="ghostMode" defaultChecked={ghost} className="size-4 accent-accent" />
            {copy.visibility.ghost}
          </label>
        </ActionForm>
      </Card>

      <Card title={copy.export.title} className="flex flex-col gap-3">
        <p className="type-body text-fg-muted">{copy.export.line}</p>
        <a
          href="/api/me/export"
          download
          className="type-body self-start text-accent underline underline-offset-4"
        >
          {copy.export.link}
        </a>
      </Card>

      <Card title={copy.delete.title} className="flex flex-col gap-3 border-state-error">
        <p className="type-body">{copy.delete.line}</p>
        <p className="type-small text-fg-muted">
          {copy.delete.github}{' '}
          <a
            href="https://github.com/settings/applications"
            rel="noreferrer"
            className="text-accent underline underline-offset-4"
          >
            {copy.delete.githubLink}
          </a>
        </p>
        <ActionForm
          action={deleteAccountAction}
          submitLabel={copy.delete.submit}
          variant="danger"
          size="md"
          className="flex flex-col gap-3"
        >
          <Input name="confirm" label={copy.delete.confirm(phrase)} autoComplete="off" required />
        </ActionForm>
      </Card>
    </div>
  );
}
