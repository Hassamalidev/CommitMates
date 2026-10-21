import type { GapFacet, GapResult } from '@commitmates/core';
import { Card, ChecklistRule, Chip } from '@commitmates/ui';

import { gapCopy } from '@/copy/gap';

import { GapCampusPanel } from './GapCampusPanel';

/** A facet in words: "A tests/ folder", "A Dockerfile file (Docker)", "A license". */
export function facetLabel(facet: Pick<GapFacet, 'facet' | 'kind' | 'name' | 'topic'>): string {
  const copy = gapCopy.facet;
  if (facet.kind === 'meta') return copy.meta[facet.name] ?? facet.name;
  const base = facet.kind === 'tag' ? copy.tag(facet.topic ?? facet.name) : facet.facet.startsWith('dir:') ? copy.dir(facet.name) : copy.file(facet.name);
  return facet.kind !== 'tag' && facet.topic ? `${base} ${copy.topic(facet.topic)}` : base;
}

/** The Gap Finder result (CLAUDE.md §8 F5 "UI"): gaps by prevalence with examples, what is already right, the peers. */
export function GapView({ result, campusMinMembers, signedIn = false }: { result: GapResult; campusMinMembers: number; signedIn?: boolean }) {
  const copy = gapCopy.result;
  const total = result.peers.length;

  return (
    <div className="flex flex-col gap-6">
      <Card as="article" pixelShadow aria-labelledby="gap-title" data-testid="gap-result" className="flex flex-col gap-6">
        <header>
          <h2 id="gap-title" className="type-h2 break-words">
            {copy.title(result.repo.fullName)}
          </h2>
          {result.lowConfidence ? <p className="type-small mt-2 text-fg-muted">{copy.lowConfidence}</p> : null}
        </header>

        {result.gaps.length === 0 ? (
          <p className="type-body">{copy.noGaps}</p>
        ) : (
          <ul>
            {result.gaps.map((gap) => (
              <ChecklistRule
                key={gap.facet}
                status="fail"
                statusLabel={copy.have(gap.peersWith, total)}
                title={facetLabel(gap)}
                evidence={copy.have(gap.peersWith, total)}
                fixLabel={copy.examples}
                fix={
                  <ul className="flex flex-col gap-1">
                    {gap.examples.map((example) => (
                      <li key={example}>
                        <a href={`https://github.com/${example}`} rel="noreferrer" className="text-accent underline underline-offset-4">
                          {example}
                        </a>
                      </li>
                    ))}
                  </ul>
                }
              />
            ))}
          </ul>
        )}

        {result.shared.length > 0 ? (
          <section aria-labelledby="gap-shared">
            <h3 id="gap-shared" className="type-h3">
              {copy.sharedTitle}
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {result.shared.map((facet) => (
                <li key={facet.facet}>
                  <Chip>{facetLabel(facet)}</Chip>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="gap-peers">
          <h3 id="gap-peers" className="type-h3">
            {copy.peersTitle(total)}
          </h3>
          <ul className="type-small mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {result.peers.map((peer) => (
              <li key={peer.fullName}>
                <a href={`https://github.com/${peer.fullName}`} rel="noreferrer" className="text-accent underline underline-offset-4">
                  {peer.fullName}
                </a>{' '}
                <span className="text-fg-muted">{copy.stars(peer.stars)}</span>
              </li>
            ))}
          </ul>
        </section>
      </Card>

      <GapCampusPanel result={result} campusMinMembers={campusMinMembers} signedIn={signedIn} label={facetLabel} />
    </div>
  );
}
