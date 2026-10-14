import { serverEnv } from '@commitmates/env/server';
import nodemailer, { type Transporter } from 'nodemailer';

import { renderEmail, type Brand, type TemplateData, type TemplateName } from './templates';

/** Implicit TLS port (SMTPS); other ports upgrade with STARTTLS. */
const SMTPS_PORT = 465;

export type SendResult = { messageId: string };

/** Anything that can deliver a rendered message; tests pass their own. */
export type MailTransport = Pick<Transporter, 'sendMail'>;

let transport: MailTransport | undefined;

/** The SMTP transport from `SMTP_*` (CLAUDE.md §14.1), created on first use. */
function defaultTransport(): MailTransport {
  const user = serverEnv.SMTP_USER;
  const pass = serverEnv.SMTP_PASS;
  transport ??= nodemailer.createTransport({
    host: serverEnv.SMTP_HOST,
    port: serverEnv.SMTP_PORT,
    secure: serverEnv.SMTP_PORT === SMTPS_PORT,
    ...(user !== undefined && pass !== undefined ? { auth: { user, pass } } : {}),
  });
  return transport;
}

/** Test helper: route mail through another transport, or back to SMTP with `undefined`. */
export function setMailTransport(next: MailTransport | undefined): void {
  transport = next;
}

const brand = (): Brand => ({ siteName: serverEnv.NEXT_PUBLIC_SITE_NAME, siteUrl: serverEnv.NEXT_PUBLIC_SITE_URL });

/**
 * Renders a template and sends it. The daily cap is enforced by the caller
 * (`packages/core`), which owns the database; this package only formats and delivers.
 */
export async function sendEmail<T extends TemplateName>(template: T, data: TemplateData[T], to: string): Promise<SendResult> {
  const message = renderEmail(template, data, brand());
  const info = (await defaultTransport().sendMail({ from: serverEnv.EMAIL_FROM, to, ...message })) as { messageId?: unknown };
  return { messageId: typeof info.messageId === 'string' ? info.messageId : '' };
}
