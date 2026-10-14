import { Accordion, Card, CompanionSprite, Icon, SpeechBubble, StateChip, buttonStyles, cn } from '@commitmates/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LiveDemo } from '@/components/landing/LiveDemo';
import { Section } from '@/components/layout/Section';
import { landingCopy } from '@/copy/landing';
import { siteCopy } from '@/copy/site';
import { brandCompanion } from '@/lib/brand';
import { siteName } from '@/lib/site';
import { AVAILABLE_TOOLS, toolPath } from '@/lib/tools';

export function generateMetadata(): Metadata {
  return {
    title: { absolute: `${siteName} — ${landingCopy.hero.title}` },
    description: siteCopy.description,
  };
}

export default function LandingPage() {
  const { hero, demo, states, tools, how, unlocks, privacy, faq } = landingCopy;

  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-content items-center gap-8 px-4 py-12 sm:py-20 md:grid-cols-[1fr_auto]">
          <div>
            <p className="type-eyebrow text-fg-muted">{hero.eyebrow}</p>
            <h1 className="type-display mt-2">{hero.title}</h1>
            <p className="type-body mt-4 max-w-reading text-fg-muted">{hero.subline}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/#demo" className={buttonStyles({ variant: 'primary', size: 'lg' })}>
                {hero.primaryCta}
              </Link>
              <a href="/auth/sign-in" className={buttonStyles({ variant: 'secondary', size: 'lg' })}>
                {hero.secondaryCta}
              </a>
            </div>
          </div>
          <div className="flex items-start gap-3 md:flex-col md:items-center">
            <CompanionSprite companion={brandCompanion} state="idle" size={160} label={hero.companionLabel} />
            <SpeechBubble tail="left" className="md:hidden">
              {hero.companionLine}
            </SpeechBubble>
            <SpeechBubble tail="bottom" className="hidden md:inline-block md:-order-1">
              {hero.companionLine}
            </SpeechBubble>
          </div>
        </div>
      </section>

      <Section id="demo" eyebrow={demo.eyebrow} title={demo.title} intro={demo.intro} className="bg-surface-2">
        <LiveDemo />
      </Section>

      <Section id="states" eyebrow={states.eyebrow} title={states.title} intro={states.intro}>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {states.items.map((item) => (
            <Card as="li" key={item.state} className="flex flex-col items-center gap-3 text-center">
              <CompanionSprite
                companion={brandCompanion}
                state={item.state}
                size={96}
                label={states.companionLabel(item.label)}
              />
              <StateChip state={item.state} label={item.label} />
              <p className="type-small text-fg-muted">{item.caption}</p>
            </Card>
          ))}
        </ul>
      </Section>

      <Section id="tools" eyebrow={tools.eyebrow} title={tools.title} intro={tools.intro} className="bg-surface-2">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tools.items.map((tool) => {
            const available = AVAILABLE_TOOLS.has(tool.slug);
            return (
              <Card as="li" key={tool.slug} pixelShadow className="flex flex-col gap-3">
                <Icon name={tool.icon} size={24} className="text-accent" />
                <h3 className="type-h3">{tool.title}</h3>
                <p className="type-small flex-1 text-fg-muted">{tool.line}</p>
                {available ? (
                  <Link
                    href={toolPath(tool.slug)}
                    aria-label={`${tools.open}: ${tool.title}`}
                    className={cn(buttonStyles({ variant: 'secondary', size: 'sm' }), 'self-start')}
                  >
                    {tools.open}
                    <Icon name="arrow_forward" size={16} />
                  </Link>
                ) : (
                  <StateChip state="working" label={tools.inDevelopment} className="self-start" />
                )}
              </Card>
            );
          })}
        </ul>
      </Section>

      <Section id="how" eyebrow={how.eyebrow} title={how.title}>
        <ol className="grid gap-4 md:grid-cols-3">
          {how.steps.map((step, index) => (
            <Card as="li" key={step.title}>
              <p className="type-eyebrow text-accent">{how.stepLabel(index + 1)}</p>
              <h3 className="type-h3 mt-1">{step.title}</h3>
              <p className="type-body mt-2 text-fg-muted">{step.line}</p>
            </Card>
          ))}
        </ol>
      </Section>

      <Section id="unlocks" eyebrow={unlocks.eyebrow} title={unlocks.title} className="bg-surface-2">
        <div className="flex max-w-reading flex-col gap-4">
          {unlocks.paragraphs.map((paragraph) => (
            <p key={paragraph} className="type-body text-fg-muted">
              {paragraph}
            </p>
          ))}
        </div>
      </Section>

      <Section id="privacy" eyebrow={privacy.eyebrow} title={privacy.title}>
        <ul className="flex max-w-reading flex-col gap-3">
          {privacy.points.map((point) => (
            <li key={point} className="type-body flex items-start gap-2">
              <Icon name="check" className="mt-1 text-state-done" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6">
          <Link href="/privacy" className="type-body text-accent underline underline-offset-4">
            {privacy.link}
          </Link>
        </p>
      </Section>

      <Section id="faq" eyebrow={faq.eyebrow} title={faq.title} className="bg-surface-2">
        <Accordion items={faq.items} className="max-w-reading" />
      </Section>
    </>
  );
}
