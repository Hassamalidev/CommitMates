import { VisuallyHidden } from '../components/VisuallyHidden';
import { cn } from '../lib/cn';

export type LanguageBarItem = {
  name: string;
  /** 0–1. */
  share: number;
  /** The language's Linguist color; `null` falls back to a neutral token. */
  color: string | null;
};

export type LanguageBarProps = {
  languages: readonly LanguageBarItem[];
  /** Caption of the data table read by screen readers, e.g. "Languages by share of code". */
  label: string;
  /** Column headings of that table. */
  nameHeading: string;
  shareHeading: string;
  className?: string;
};

const PERCENT = 100;

/** "42%", and "<1%" for a sliver that would otherwise round to nothing. */
export function formatSharePercent(share: number): string {
  const percent = Math.round(share * PERCENT);
  return percent === 0 && share > 0 ? '<1%' : `${percent}%`;
}

/**
 * A stacked horizontal bar of language shares with a legend (CLAUDE.md §9.4). The colors
 * are data (GitHub Linguist), so they are the one place a raw color reaches the page.
 */
export function LanguageBar({ languages, label, nameHeading, shareHeading, className }: LanguageBarProps) {
  const visible = languages.filter((language) => language.share > 0);
  if (visible.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {visible.map((language) => (
          <span
            key={language.name}
            data-language={language.name}
            className={cn('h-full', language.color === null && 'bg-fg-muted')}
            style={{
              width: `${language.share * PERCENT}%`,
              ...(language.color === null ? {} : { backgroundColor: language.color }),
            }}
          />
        ))}
      </div>
      <ul aria-hidden="true" className="type-small flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
        {visible.map((language) => (
          <li key={language.name} className="flex items-center gap-1.5">
            <span
              className={cn('size-2.5 rounded-full', language.color === null && 'bg-fg-muted')}
              style={language.color === null ? undefined : { backgroundColor: language.color }}
            />
            <span className="text-fg">{language.name}</span>
            <span>{formatSharePercent(language.share)}</span>
          </li>
        ))}
      </ul>
      <VisuallyHidden as="table">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{nameHeading}</th>
            <th scope="col">{shareHeading}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((language) => (
            <tr key={language.name}>
              <th scope="row">{language.name}</th>
              <td>{formatSharePercent(language.share)}</td>
            </tr>
          ))}
        </tbody>
      </VisuallyHidden>
    </div>
  );
}
