import type { ReactNode } from 'react';

import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../lib/cn';

export type RuleStatus = 'pass' | 'partial' | 'fail';

const statusStyle: Record<RuleStatus, { icon: IconName; color: string }> = {
  pass: { icon: 'check_circle', color: 'text-state-done' },
  partial: { icon: 'do_not_disturb_on', color: 'text-state-working' },
  fail: { icon: 'cancel', color: 'text-state-error' },
};

export type ChecklistRuleProps = {
  status: RuleStatus;
  /** Read by screen readers in place of the icon, e.g. "Passed". */
  statusLabel: string;
  title: string;
  /** The evidence behind the result, e.g. "3 of 5 pinned repos have a README over 600 characters". */
  evidence: string;
  /** Label of the expandable fix, e.g. "How to fix". */
  fixLabel?: string;
  /** The constructive fix. Every score comes with one (CLAUDE.md §2.8). */
  fix?: ReactNode;
  className?: string;
};

export function ChecklistRule({ status, statusLabel, title, evidence, fixLabel, fix, className }: ChecklistRuleProps) {
  const style = statusStyle[status];
  return (
    <li data-status={status} className={cn('flex gap-3 border-b border-line py-3 last:border-b-0', className)}>
      <Icon name={style.icon} size={24} label={statusLabel} className={cn('mt-0.5', style.color)} />
      <div className="min-w-0 flex-1">
        <p className="type-body font-semibold text-fg">{title}</p>
        <p className="type-small text-fg-muted">{evidence}</p>
        {fix && fixLabel ? (
          <details className="mt-2">
            <summary className="type-small inline-flex min-h-11 cursor-pointer items-center font-semibold text-accent sm:min-h-0">
              {fixLabel}
            </summary>
            <div className="type-small mt-1 text-fg">{fix}</div>
          </details>
        ) : null}
      </div>
    </li>
  );
}
