/** Workspace name of this package; used in logs and diagnostics. */
export const PACKAGE_NAME = '@commitmates/email';

export { ACCOUNT_NOTICES, escapeHtml, renderEmail, type Brand, type DigestItem, type RenderedEmail, type TemplateData, type TemplateName } from './templates';
export { sendEmail, setMailTransport, type MailTransport, type SendResult } from './transport';
