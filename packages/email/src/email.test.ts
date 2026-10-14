import { afterEach, describe, expect, it, vi } from 'vitest';

import { escapeHtml, renderEmail } from './templates';
import { sendEmail, setMailTransport } from './transport';

const brand = { siteName: 'CommitMates', siteUrl: 'https://commitmates.example' };

afterEach(() => {
  setMailTransport(undefined);
});

describe('renderEmail', () => {
  it('renders the verification code in text and HTML, with the expiry', () => {
    const email = renderEmail('verificationCode', { code: '042917', minutes: 10, universityName: 'Uni of Testland' }, brand);
    expect(email.subject).toBe('Your CommitMates code: 042917');
    expect(email.text).toContain('Use this code to confirm you study at Uni of Testland.');
    expect(email.text).toContain('042917');
    expect(email.text).toContain('expires in 10 minutes');
    expect(email.html).toContain('042917');
    expect(email.html).toMatch(/^<!doctype html>/);
  });

  it('builds a digest with absolute links and a way to turn it off', () => {
    const email = renderEmail(
      'digest',
      {
        items: [
          { title: 'New message request', line: 'Sam wants to build a CLI with you.', path: '/inbox' },
          { title: 'Streak', line: 'Day 7 together.' },
        ],
        settingsPath: '/settings/notifications',
      },
      brand,
    );
    expect(email.subject).toBe('2 updates on CommitMates');
    expect(email.text).toContain('• New message request: Sam wants to build a CLI with you. https://commitmates.example/inbox');
    expect(email.text).toContain('https://commitmates.example/settings/notifications');
    expect(email.html).toContain('href="https://commitmates.example/inbox"');
    expect(renderEmail('digest', { items: [{ title: 'x', line: 'y' }], settingsPath: '/s' }, brand).subject).toBe('1 update on CommitMates');
  });

  it('writes kind, neutral account notices', () => {
    expect(renderEmail('accountNotice', { notice: 'suspended', days: 7 }, brand).text).toContain('paused your account for 7 days');
    expect(renderEmail('accountNotice', { notice: 'suspended' }, brand).text).not.toContain('undefined');
    expect(renderEmail('accountNotice', { notice: 'deletion_confirmed' }, brand).subject).toBe('Your account was deleted');
    expect(renderEmail('accountNotice', { notice: 'restored' }, brand).subject).toBe('Your account is active again');
  });

  it('escapes everything that comes from data in the HTML body', () => {
    const email = renderEmail('digest', { items: [{ title: '<script>alert(1)</script>', line: '"quoted" & more' }], settingsPath: '/s' }, brand);
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('&quot;quoted&quot; &amp; more');
    expect(escapeHtml(`<a href='x'>`)).toBe('&lt;a href=&#39;x&#39;&gt;');
  });
});

describe('sendEmail', () => {
  it('sends the rendered message from EMAIL_FROM to the recipient', async () => {
    vi.stubEnv('EMAIL_FROM', 'CommitMates <no-reply@commitmates.example>');
    vi.stubEnv('NEXT_PUBLIC_SITE_NAME', 'CommitMates');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://commitmates.example');
    const sendMail = vi.fn(() => Promise.resolve({ messageId: '<abc@mail>' }));
    setMailTransport({ sendMail } as never);
    const result = await sendEmail('accountNotice', { notice: 'restored' }, 'ada@uni.edu');
    expect(result).toEqual({ messageId: '<abc@mail>' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'CommitMates <no-reply@commitmates.example>',
        to: 'ada@uni.edu',
        subject: 'Your account is active again',
        text: expect.stringContaining('active again') as string,
        html: expect.stringContaining('<!doctype html>') as string,
      }),
    );
  });
});
