// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShareButton } from './ShareButton';

const URL_TO_SHARE = 'https://commitmates.example/u/fixture-user-1';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubNavigator(value: Partial<Navigator>) {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator) as Navigator, value));
}

describe('ShareButton', () => {
  it('uses the share sheet where the device has one', async () => {
    const share = vi.fn(() => Promise.resolve());
    stubNavigator({ share });
    render(<ShareButton url={URL_TO_SHARE} title="@fixture-user-1 on CommitMates" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Shared.');
    });
    expect(share).toHaveBeenCalledWith({ url: URL_TO_SHARE, title: '@fixture-user-1 on CommitMates' });
  });

  it('copies the link where there is no share sheet', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({ share: undefined as unknown as Navigator['share'], clipboard: { writeText } as unknown as Clipboard });
    render(<ShareButton url={URL_TO_SHARE} title="t" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Link copied.');
    });
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE);
  });

  it('says nothing when the share sheet is dismissed, and explains a failed copy', async () => {
    stubNavigator({ share: vi.fn(() => Promise.reject(new DOMException('dismissed', 'AbortError'))) });
    const { unmount } = render(<ShareButton url={URL_TO_SHARE} title="t" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('status').textContent).toBe('');
    unmount();

    stubNavigator({
      share: undefined as unknown as Navigator['share'],
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) } as unknown as Clipboard,
    });
    render(<ShareButton url={URL_TO_SHARE} title="t" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Could not copy the link');
    });
  });
});
