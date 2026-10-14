'use client';

import { Card, Icon } from '@commitmates/ui';
import { useEffect, useState } from 'react';

import { recruiterCopy, secretRuleName } from '@/copy/recruiter';
import type { OwnSecretScan } from '@/server/actions/recruiter';

export type SecretPanelProps = {
  /** Reads the signed-in member's own scan; the server decides whose it is. */
  load: () => Promise<{ ok: true; data: OwnSecretScan } | { ok: false; error: { message: string } }>;
};

type State = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; scan: OwnSecretScan };

/** The owner's secret-scan results, in a warning style (CLAUDE.md §8 F3 "UI"). */
export function SecretPanel({ load }: SecretPanelProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const copy = recruiterCopy.secrets;

  useEffect(() => {
    let active = true;
    void load().then(
      (result) => {
        if (active) setState(result.ok ? { status: 'ready', scan: result.data } : { status: 'failed' });
      },
      () => {
        if (active) setState({ status: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  return (
    <Card as="section" aria-labelledby="secret-panel-title" data-testid="secret-panel" className="border-state-error">
      <h2 id="secret-panel-title" className="type-h3 flex items-center gap-2 text-state-error">
        <Icon name="warning" size={24} />
        {copy.title}
      </h2>
      <p className="type-small mt-1 text-fg-muted">{copy.line}</p>
      <div className="mt-4">
        {state.status === 'loading' ? <p className="type-small text-fg-muted">{copy.loading}</p> : null}
        {state.status === 'failed' ? <p className="type-small text-state-error">{copy.failed}</p> : null}
        {state.status === 'ready' && state.scan ? (
          <>
            {state.scan.findings.length === 0 ? (
              <p className="type-body">{copy.none(state.scan.filesScanned)}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {state.scan.findings.map((finding) => (
                    <li key={`${finding.repo}/${finding.path}:${finding.line}:${finding.ruleId}`} className="type-body font-mono break-all">
                      {copy.finding(secretRuleName(finding.ruleId), finding.repo, finding.path, finding.line)}
                    </li>
                  ))}
                </ul>
                <p className="type-small mt-3">{copy.fix}</p>
              </>
            )}
            {state.scan.partial ? <p className="type-small mt-2 text-fg-muted">{copy.partial(state.scan.filesScanned)}</p> : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
