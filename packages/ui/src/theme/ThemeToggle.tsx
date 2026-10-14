'use client';

import { useEffect, useState } from 'react';

import { Icon, type IconName } from '../icons/Icon';
import { cn } from '../lib/cn';

import {
  THEME_STORAGE_KEY,
  isThemePreference,
  nextPreference,
  resolveTheme,
  type ThemePreference,
} from './theme';

const icons: Record<ThemePreference, IconName> = { system: 'computer', light: 'light_mode', dark: 'dark_mode' };

const DARK_QUERY = '(prefers-color-scheme: dark)';

export type ThemeToggleProps = {
  /** Visible label per preference, e.g. { system: 'System theme', light: 'Light theme', dark: 'Dark theme' }. */
  labels: Record<ThemePreference, string>;
  /** Accessible description of what pressing does, e.g. "Change theme". */
  actionLabel: string;
  className?: string;
};

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(preference: ThemePreference): void {
  const prefersDark = window.matchMedia(DARK_QUERY).matches;
  document.documentElement.dataset.theme = resolveTheme(preference, prefersDark);
}

/** Cycles system → light → dark. The choice is stored on the device and follows the system by default. */
export function ThemeToggle({ labels, actionLabel, className }: ThemeToggleProps) {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    // The stored choice is only known in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreference(readPreference());
  }, []);

  useEffect(() => {
    apply(preference);
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      apply('system');
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [preference]);

  const choose = () => {
    const next = nextPreference(preference);
    setPreference(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this page only.
    }
  };

  return (
    <button
      type="button"
      onClick={choose}
      title={actionLabel}
      className={cn(
        'type-small inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-fg-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
    >
      <Icon name={icons[preference]} />
      <span>{labels[preference]}</span>
    </button>
  );
}
