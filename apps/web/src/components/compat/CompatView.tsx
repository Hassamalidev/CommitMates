'use client';

import type { CompatResult } from '@commitmates/core';
import { Card, CompanionView, ScoreDial } from '@commitmates/ui';
import { useEffect, useState } from 'react';

import { compatCopy, type CompatComponentKey } from '@/copy/compat';
import { localHourRange } from '@/lib/compat';
import { companionFor } from '@/lib/dev-card';

const COMPONENT_ORDER: readonly CompatComponentKey[] = ['skill', 'interest', 'rhythm', 'complement'];

/** The shared active hours in the viewer's own time; worked out after hydration, where the browser's timezone is known. */
function useLocalWindow(window: CompatResult['explanations']['window']): [string, string] | null {
  const [range, setRange] = useState<[string, string] | null>(null);
  useEffect(() => {
    if (!window) return;
    const frame = requestAnimationFrame(() => {
      setRange(localHourRange(window));
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [window]);
  return range;
}

/**
 * A comparison (CLAUDE.md §8 F2 "UI"): the two companions facing each other, the score,
 * its band, the four components with what each means, and the real signals behind them.
 */
export function CompatView({ result }: { result: CompatResult }) {
  const { a, b, explanations } = result;
  const band = result.band === null ? compatCopy.fallbackBand : (compatCopy.bands[result.band] ?? compatCopy.fallbackBand);
  const window = useLocalWindow(explanations.window);
  const copy = compatCopy.result;

  const why = [
    explanations.sharedTags.length > 0 ? compatCopy.explanations.sharedTags(explanations.sharedTags) : null,
    explanations.sharedStars.length > 0 ? compatCopy.explanations.sharedStars(explanations.sharedStars) : null,
    window ? compatCopy.explanations.window(window[0], window[1]) : null,
    explanations.strengthA ? compatCopy.explanations.strength(a.login, explanations.strengthA) : null,
    explanations.strengthB ? compatCopy.explanations.strength(b.login, explanations.strengthB) : null,
  ].filter((line): line is string => line !== null);

  return (
    <Card as="article" pixelShadow aria-labelledby="compat-title" data-testid="compat-result" className="flex flex-col gap-8">
      <header className="flex flex-col items-center gap-4 text-center">
        <h2 id="compat-title" className="type-h2 break-words">
          {copy.title(a.login, b.login)}
        </h2>
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          <CompanionView companion={companionFor(a)} state="idle" size={96} label={copy.companionLabel(a.login)} />
          {result.score === null ? null : (
            <ScoreDial score={result.score} label={copy.scoreLabel} formatValue={copy.scoreValue} size={120} />
          )}
          {/* Mirrored so the two face each other. */}
          <CompanionView companion={companionFor(b)} state="idle" size={96} label={copy.companionLabel(b.login)} className="-scale-x-100" />
        </div>
        {result.score === null ? (
          <p className="type-body text-fg-muted">{copy.noScore}</p>
        ) : (
          <div>
            <p className="type-h3">{band.title}</p>
            <p className="type-body mt-1 max-w-reading text-fg-muted">{band.line}</p>
          </div>
        )}
      </header>

      <section aria-labelledby="compat-components">
        <h3 id="compat-components" className="type-h3">
          {copy.componentsTitle}
        </h3>
        <ul className="mt-3 flex flex-col gap-4">
          {COMPONENT_ORDER.map((key) => {
            const value = result.components[key];
            const text = compatCopy.components[key];
            return (
              <li key={key} data-component={key}>
                <p className="flex items-baseline justify-between gap-3">
                  <span className="type-body font-semibold">{text.name}</span>
                  <span className="type-small font-mono text-fg-muted">
                    {value === null ? copy.notEnoughData : compatCopy.componentValue(value)}
                  </span>
                </p>
                <div aria-hidden="true" className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  {value === null ? null : <div className="h-full rounded-full bg-accent" style={{ width: `${value * 100}%` }} />}
                </div>
                <p className="type-small mt-1 text-fg-muted">{text.line}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="compat-why">
        <h3 id="compat-why" className="type-h3">
          {copy.whyTitle}
        </h3>
        {why.length === 0 ? (
          <p className="type-small mt-2 text-fg-muted">{copy.nothingShared}</p>
        ) : (
          <ul className="type-body mt-2 flex list-disc flex-col gap-1 pl-5">
            {why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
