'use client';

import { Button, Dialog, Textarea } from '@commitmates/ui';
import { useActionState } from 'react';

import { safetyCopy } from '@/copy/safety';
import type { ActionResult } from '@/server/action';
import { reportAction } from '@/server/actions/safety';

const REASONS = Object.keys(safetyCopy.report.reasons) as (keyof typeof safetyCopy.report.reasons)[];

export type ReportDialogProps = {
  targetUserId: string;
  login: string;
  /** Set when the report is about one message. */
  messageId?: string | undefined;
  detailsMax: number;
  onClose: () => void;
  onSent: () => void;
};

/** A report with a reason and optional details (CLAUDE.md §8 F12 "Reports and auto-hide"). */
export function ReportDialog({ targetUserId, login, messageId, detailsMax, onClose, onSent }: ReportDialogProps) {
  const copy = safetyCopy.report;
  const [result, action, pending] = useActionState(async (previous: ActionResult<null> | null, formData: FormData) => {
    const outcome = await reportAction(previous, formData);
    if (outcome.ok) onSent();
    return outcome;
  }, null);
  const error = result && !result.ok ? result.error : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={messageId ? copy.messageTitle(login) : copy.title(login)}
      description={copy.line}
      closeLabel={copy.close}
    >
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="targetUserId" value={targetUserId} />
        <input type="hidden" name="messageId" value={messageId ?? ''} />
        <fieldset className="flex flex-col gap-1">
          <legend className="type-small mb-1 font-semibold">{copy.reasonLegend}</legend>
          {REASONS.map((reason, index) => (
            <label key={reason} className="type-small flex min-h-11 items-center gap-2">
              <input type="radio" name="reason" value={reason} defaultChecked={index === 0} required />
              {copy.reasons[reason]}
            </label>
          ))}
        </fieldset>
        <Textarea
          label={copy.details}
          name="details"
          maxLength={detailsMax}
          rows={3}
          description={copy.detailsHelp(detailsMax)}
          error={error?.field === 'details' ? error.message : undefined}
        />
        {error && error.field !== 'details' ? (
          <p role="alert" className="type-small text-state-error">
            {error.message}
          </p>
        ) : null}
        <Button type="submit" variant="danger" loading={pending} className="self-start">
          {copy.submit}
        </Button>
      </form>
    </Dialog>
  );
}
