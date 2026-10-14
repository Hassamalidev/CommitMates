'use client';

import type { RecruiterResult } from '@commitmates/core';
import { Card, ChecklistRule, ScoreDial } from '@commitmates/ui';

import { isRecruiterRuleKey, recruiterCopy } from '@/copy/recruiter';

/**
 * A Recruiter-Ready report (CLAUDE.md §8 F3 "UI"): the score dial, then every rule as a
 * checklist item with its evidence and a fix.
 */
export function RecruiterView({ result }: { result: RecruiterResult }) {
  const copy = recruiterCopy.result;
  const checked = result.rules.filter((rule) => rule.status !== 'not-applicable' && isRecruiterRuleKey(rule.key));
  const notChecked = result.rules
    .filter((rule) => rule.status === 'not-applicable' && isRecruiterRuleKey(rule.key))
    .map((rule) => (isRecruiterRuleKey(rule.key) ? recruiterCopy.rules[rule.key].title : rule.key));

  return (
    <Card as="article" pixelShadow aria-labelledby="recruiter-title" data-testid="recruiter-result" className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <h2 id="recruiter-title" className="type-h2 break-words">
          {copy.title(result.login)}
        </h2>
        {result.score === null ? (
          <p className="type-body text-fg-muted">{copy.noScore}</p>
        ) : (
          <ScoreDial score={result.score} label={copy.scoreLabel} formatValue={copy.scoreValue} />
        )}
        {result.usedTopRepos ? <p className="type-small text-fg-muted">{copy.usedTop}</p> : null}
      </header>

      <section aria-labelledby="recruiter-checklist">
        <h3 id="recruiter-checklist" className="type-h3">
          {copy.checklistTitle}
        </h3>
        <ul className="mt-2">
          {checked.map((rule) => {
            if (!isRecruiterRuleKey(rule.key) || rule.status === 'not-applicable') return null;
            const text = recruiterCopy.rules[rule.key];
            return (
              <ChecklistRule
                key={rule.key}
                status={rule.status}
                statusLabel={copy.status[rule.status]}
                title={text.title}
                evidence={text.evidence(rule.evidence)}
                {...(rule.status === 'pass' ? {} : { fixLabel: copy.fixLabel, fix: text.fix })}
              />
            );
          })}
        </ul>
        {notChecked.length > 0 ? <p className="type-small mt-3 text-fg-muted">{copy.notChecked(notChecked.join(', '))}</p> : null}
      </section>
    </Card>
  );
}
