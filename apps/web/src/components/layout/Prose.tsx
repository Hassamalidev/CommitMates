import { serverEnv } from '@commitmates/env/server';
import type { ReactNode } from 'react';

import { legalCopy } from '@/copy/legal';

export type ProseSection = { title: string; paragraphs: readonly string[] };

export type ProsePageProps = {
  title: string;
  intro: string;
  updated: string;
  sections?: readonly ProseSection[];
  children?: ReactNode;
};

/** Reading-width page for policies and other long text. */
export function ProsePage({ title, intro, updated, sections = [], children }: ProsePageProps) {
  return (
    <article className="mx-auto max-w-reading px-4 py-12">
      <h1 className="type-h1">{title}</h1>
      <p className="type-small mt-2 text-fg-muted">{legalCopy.updated(updated)}</p>
      <p className="type-body mt-6">{intro}</p>
      {sections.map((section) => (
        <section key={section.title} className="mt-8">
          <h2 className="type-h3">{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="type-body mt-3 text-fg-muted">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {children}
      <p className="type-small mt-10 border-t border-line pt-4 text-fg-muted">{legalCopy.contact(serverEnv.CONTACT_EMAIL)}</p>
    </article>
  );
}
