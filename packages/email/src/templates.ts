/** Where the message comes from; read from the environment by the transport. */
export type Brand = { siteName: string; siteUrl: string };

export type RenderedEmail = { subject: string; text: string; html: string };

/** The account notices the `accountNotice` template can send. */
export const ACCOUNT_NOTICES = ['deletion_confirmed', 'suspended', 'restored'] as const;

export type DigestItem = { title: string; line: string; path?: string | undefined };

/** Every template and the data it needs. Data never includes anything we must not store. */
export type TemplateData = {
  verificationCode: { code: string; minutes: number; universityName: string | null };
  digest: { items: DigestItem[]; settingsPath: string };
  accountNotice: { notice: (typeof ACCOUNT_NOTICES)[number]; days?: number | undefined };
};

export type TemplateName = keyof TemplateData;

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const absolute = (brand: Brand, path: string) => new URL(path, brand.siteUrl).toString();

/**
 * A minimal, inline-styled HTML body. Email clients ignore stylesheets and CSS variables, so the
 * light theme's token values (packages/ui/src/tokens.css) are written inline here.
 */
function html(brand: Brand, title: string, paragraphs: readonly string[]): string {
  const body = paragraphs.map((paragraph) => `<p style="margin:0 0 16px">${paragraph}</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f7f6f2;color:#151923;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ddd9cf;border-radius:16px;padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px">${escapeHtml(title)}</h1>${body}
<p style="margin:24px 0 0;font-size:14px;color:#5b6475">${escapeHtml(brand.siteName)} · <a href="${escapeHtml(brand.siteUrl)}" style="color:#177a30">${escapeHtml(brand.siteUrl)}</a></p>
</div></body></html>`;
}

const footer = (brand: Brand) => `\n\n${brand.siteName} · ${brand.siteUrl}\n`;

type Renderer<T extends TemplateName> = (data: TemplateData[T], brand: Brand) => RenderedEmail;

const renderers: { [T in TemplateName]: Renderer<T> } = {
  verificationCode: ({ code, minutes, universityName }, brand) => {
    const subject = `Your ${brand.siteName} code: ${code}`;
    const intro = universityName
      ? `Use this code to confirm you study at ${universityName}.`
      : 'Use this code to confirm your university email.';
    const expiry = `It expires in ${minutes} minutes. If you did not ask for it, you can ignore this email.`;
    return {
      subject,
      text: `${intro}\n\n    ${code}\n\n${expiry}${footer(brand)}`,
      html: html(brand, 'Your verification code', [
        escapeHtml(intro),
        `<span style="display:inline-block;font-family:'Courier New',monospace;font-size:28px;letter-spacing:6px;font-weight:bold">${escapeHtml(code)}</span>`,
        escapeHtml(expiry),
      ]),
    };
  },

  digest: ({ items, settingsPath }, brand) => {
    const subject = items.length === 1 ? `1 update on ${brand.siteName}` : `${items.length} updates on ${brand.siteName}`;
    const settings = absolute(brand, settingsPath);
    const lines = items.map((item) => `• ${item.title}: ${item.line}${item.path ? ` ${absolute(brand, item.path)}` : ''}`);
    const htmlItems = items.map((item) => {
      const title = item.path
        ? `<a href="${escapeHtml(absolute(brand, item.path))}" style="color:#177a30">${escapeHtml(item.title)}</a>`
        : `<strong>${escapeHtml(item.title)}</strong>`;
      return `${title}<br>${escapeHtml(item.line)}`;
    });
    const unsubscribe = 'You get this daily summary because email digests are on.';
    return {
      subject,
      text: `Here is what happened since your last summary.\n\n${lines.join('\n')}\n\n${unsubscribe} Change it in your settings: ${settings}${footer(brand)}`,
      html: html(brand, 'Your daily summary', [
        'Here is what happened since your last summary.',
        ...htmlItems,
        `${escapeHtml(unsubscribe)} <a href="${escapeHtml(settings)}" style="color:#177a30">Change it in your settings</a>.`,
      ]),
    };
  },

  accountNotice: ({ notice, days }, brand) => {
    const content = {
      deletion_confirmed: {
        title: 'Your account was deleted',
        line: `Your ${brand.siteName} account and its data have been deleted, as you asked. Thank you for building with us.`,
      },
      suspended: {
        title: 'Your account is paused',
        line:
          days === undefined
            ? 'A moderator paused your account after reviewing reports. You can reply through the feedback form if you think this is a mistake.'
            : `A moderator paused your account for ${days} days after reviewing reports. You can reply through the feedback form if you think this is a mistake.`,
      },
      restored: {
        title: 'Your account is active again',
        line: 'Your account is active again. Thank you for your patience.',
      },
    }[notice];
    return {
      subject: content.title,
      text: `${content.line}${footer(brand)}`,
      html: html(brand, content.title, [escapeHtml(content.line)]),
    };
  },
};

/** Renders a template to a subject, a plain-text body and a simple HTML body. */
export function renderEmail<T extends TemplateName>(template: T, data: TemplateData[T], brand: Brand): RenderedEmail {
  const render = renderers[template] as Renderer<T>;
  return render(data, brand);
}
