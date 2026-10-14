import { Card, Icon, buttonStyles, cn } from '@commitmates/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { landingCopy, type ToolSlug } from '@/copy/landing';
import { toolsCopy } from '@/copy/tools';
import { AVAILABLE_TOOLS, toolPath } from '@/lib/tools';

export type ToolPageProps = {
  slug: ToolSlug;
  eyebrow: string;
  title: string;
  line: string;
  /** The input card and the result area. */
  children: ReactNode;
  /** Visitors are offered sign-in to save and share; members are not. */
  signedIn: boolean;
};

/** Related tools: every live tool except the one on screen, in landing-page order. */
export function relatedTools(current: ToolSlug, available: ReadonlySet<ToolSlug> = AVAILABLE_TOOLS) {
  return landingCopy.tools.items.filter((tool) => tool.slug !== current && available.has(tool.slug));
}

/**
 * The shared layout of every day-one tool (CLAUDE.md §9.6): heading, the tool itself,
 * a sign-in offer for visitors, then other tools to try.
 */
export function ToolPage({ slug, eyebrow, title, line, children, signedIn }: ToolPageProps) {
  const related = relatedTools(slug);
  const { page } = toolsCopy;

  return (
    <div className="mx-auto flex max-w-content flex-col gap-8 px-4 py-10 sm:py-14">
      <header>
        <p className="type-eyebrow text-fg-muted">{eyebrow}</p>
        <h1 className="type-h1 mt-1">{title}</h1>
        <p className="type-body mt-2 max-w-reading text-fg-muted">{line}</p>
      </header>

      {children}

      {signedIn ? null : (
        <Card title={page.saveTitle} className="flex flex-col items-start gap-3">
          <p className="type-body text-fg-muted">{page.saveLine}</p>
          <a
            href={`/auth/sign-in?next=${encodeURIComponent(toolPath(slug))}`}
            className={buttonStyles({ variant: 'secondary', size: 'md' })}
          >
            {page.saveAction}
          </a>
        </Card>
      )}

      {related.length > 0 ? (
        <section aria-labelledby="try-next-title">
          <h2 id="try-next-title" className="type-h2">
            {page.nextTitle}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((tool) => (
              <Card as="li" key={tool.slug} className="flex flex-col gap-3">
                <Icon name={tool.icon} size={24} className="text-accent" />
                <h3 className="type-h3">{tool.title}</h3>
                <p className="type-small flex-1 text-fg-muted">{tool.line}</p>
                <Link
                  href={toolPath(tool.slug)}
                  aria-label={`${page.open}: ${tool.title}`}
                  className={cn(buttonStyles({ variant: 'secondary', size: 'sm' }), 'self-start')}
                >
                  {page.open}
                </Link>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
