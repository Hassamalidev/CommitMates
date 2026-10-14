import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ICON_PATHS } from '../icons/paths.generated';

import { ThemeToggle } from './ThemeToggle';
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY, isThemePreference, nextPreference, resolveTheme } from './theme';

const labels = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function mockSystemTheme(dark: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: dark,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme helpers', () => {
  it('resolves the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('cycles system, light, dark', () => {
    expect(nextPreference('system')).toBe('light');
    expect(nextPreference('light')).toBe('dark');
    expect(nextPreference('dark')).toBe('system');
  });

  it('validates stored values', () => {
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('blue')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('THEME_INIT_SCRIPT', () => {
  const run = () => {
    // The script is our own constant; evaluating it is how the browser runs it too.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(THEME_INIT_SCRIPT)();
  };

  it('applies the stored theme before paint', () => {
    mockSystemTheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the system when nothing valid is stored', () => {
    mockSystemTheme(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    run();
    expect(document.documentElement.dataset.theme).toBe('light');
    mockSystemTheme(true);
    window.localStorage.clear();
    run();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('ThemeToggle', () => {
  it('starts on the system theme and persists each choice', async () => {
    mockSystemTheme(true);
    render(<ThemeToggle labels={labels} actionLabel="Change theme" />);
    const button = screen.getByRole('button', { name: 'System theme' });
    expect(document.documentElement.dataset.theme).toBe('dark');

    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await userEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'System theme' })).toBeVisible();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('restores a stored choice', async () => {
    mockSystemTheme(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    render(<ThemeToggle labels={labels} actionLabel="Change theme" />);
    expect(await screen.findByRole('button', { name: 'Light theme' })).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('icon subset', () => {
  it('ships path data for every icon', () => {
    for (const [name, path] of Object.entries(ICON_PATHS)) {
      expect(path.length, name).toBeGreaterThan(10);
      expect(path, name).toMatch(/^[Mm]/);
    }
  });
});
