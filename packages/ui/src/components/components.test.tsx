import { findA11yViolations } from '@commitmates/config/testing/axe';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Accordion,
  Avatar,
  Button,
  Card,
  ChecklistRule,
  Chip,
  Combobox,
  Dialog,
  DropdownMenu,
  EmptyState,
  Icon,
  Input,
  Popover,
  Select,
  Skeleton,
  StateChip,
  Tabs,
  TerminalWindow,
  Textarea,
  ToastProvider,
  Tooltip,
  UnlockCard,
  sizedAvatarUrl,
  useToast,
} from '../index';

const expectAccessible = async (container: Element) => {
  expect(await findA11yViolations(container)).toEqual([]);
};

describe('Button', () => {
  it('renders variants and handles clicks', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <main>
        <Button onClick={onClick}>Open</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Skip</Button>
        <Button variant="danger">Delete account</Button>
      </main>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('type', 'button');
    await expectAccessible(container);
  });

  it('blocks clicks and reports busy while loading, keeping its label for width', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('form controls', () => {
  it('links labels, descriptions and errors', async () => {
    const { container } = render(
      <form>
        <Input label="University email" description="We only keep the domain." type="email" name="email" />
        <Textarea label="Idea" error="Describe your idea in at least 50 characters." name="idea" />
        <Select
          label="Role"
          name="role"
          placeholder="Choose a role"
          defaultValue=""
          options={[
            { value: 'student', label: 'Student' },
            { value: 'alumni', label: 'Alumni' },
          ]}
        />
      </form>,
    );

    const email = screen.getByLabelText('University email');
    expect(email).toHaveAccessibleDescription('We only keep the domain.');
    expect(email).not.toHaveAttribute('aria-invalid');

    const idea = screen.getByLabelText('Idea');
    expect(idea).toHaveAttribute('aria-invalid', 'true');
    expect(idea).toHaveAccessibleDescription('Describe your idea in at least 50 characters.');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 50 characters');

    await userEvent.selectOptions(screen.getByLabelText('Role'), 'alumni');
    expect(screen.getByLabelText('Role')).toHaveValue('alumni');
    await expectAccessible(container);
  });
});

describe('Combobox', () => {
  const options = [
    { value: 'cs', label: 'Computer Science' },
    { value: 'ee', label: 'Electrical Engineering' },
    { value: 'se', label: 'Software Engineering' },
  ];

  function Example({ onChange }: { onChange: (value: string | null) => void }) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Combobox
        label="Department"
        name="department"
        emptyText="No departments found"
        options={options}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }

  it('filters as the user types and selects with the keyboard', async () => {
    const onChange = vi.fn();
    const { container } = render(<Example onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Department' });

    await userEvent.type(input, 'eng');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Electrical Engineering',
      'Software Engineering',
    ]);

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('se');
    expect(input).toHaveValue('Software Engineering');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('input[type="hidden"]')).toHaveValue('se');
    await expectAccessible(container);
  });

  it('shows the empty text and closes on Escape', async () => {
    render(<Example onChange={vi.fn()} />);
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('No departments found')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects with the mouse', async () => {
    const onChange = vi.fn();
    render(<Example onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Computer Science' }));
    expect(onChange).toHaveBeenLastCalledWith('cs');
  });
});

describe('display components', () => {
  it('renders cards, chips, skeletons and empty states accessibly', async () => {
    const { container } = render(
      <main>
        <h1>Tools</h1>
        <Card eyebrow="Day one" title="Dev Card" pixelShadow>
          <p>Your coding rhythm.</p>
          <Chip>typescript</Chip>
          <StateChip state="working" label="Working" />
          <StateChip state="error" label="Error" />
        </Card>
        <Skeleton className="h-6 w-40" />
        <EmptyState
          title="No suggestions yet"
          description="New people appear here tomorrow."
          action={<Button variant="secondary">Invite classmates</Button>}
        />
      </main>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Dev Card' })).toBeVisible();
    expect(screen.getByText('Working').closest('[data-state]')).toHaveAttribute('data-state', 'working');
    await expectAccessible(container);
  });

  it('labels an icon only when asked', () => {
    const { container } = render(
      <>
        <Icon name="lock" />
        <Icon name="check" label="Passed" />
      </>,
    );
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('img', { name: 'Passed' })).toBeVisible();
  });
});

describe('Avatar', () => {
  it('requests GitHub avatars at twice the display size', () => {
    expect(sizedAvatarUrl('https://avatars.githubusercontent.com/u/583231?v=4', 40)).toBe(
      'https://avatars.githubusercontent.com/u/583231?v=4&s=80',
    );
  });

  it('refuses other hosts and falls back', () => {
    expect(sizedAvatarUrl('https://evil.example/a.png', 40)).toBeNull();
    expect(sizedAvatarUrl('http://avatars.githubusercontent.com/u/1', 40)).toBeNull();
    expect(sizedAvatarUrl('not a url', 40)).toBeNull();

    render(<Avatar src="https://evil.example/a.png" alt="ada" fallback={<span>fallback</span>} />);
    expect(screen.getByText('fallback')).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the image with its text alternative', () => {
    render(<Avatar src="https://avatars.githubusercontent.com/u/1" alt="ada" fallback={null} size={64} />);
    expect(screen.getByRole('img', { name: 'ada' })).toHaveAttribute('width', '64');
  });
});

describe('UnlockCard', () => {
  it('exposes progress toward the unlock', async () => {
    const { container } = render(
      <UnlockCard
        title="Matching"
        description="Unlocks when 20 classmates are verified."
        current={14}
        required={20}
        progressLabel="14 / 20 verified members"
        action={<Button variant="secondary">Copy invite link</Button>}
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Matching' });
    expect(bar).toHaveAttribute('aria-valuenow', '14');
    expect(bar).toHaveAttribute('aria-valuemax', '20');
    expect(bar).toHaveAttribute('aria-valuetext', '14 / 20 verified members');
    await expectAccessible(container);
  });

  it('clamps progress and tolerates a zero requirement', () => {
    render(<UnlockCard title="Legacy" description="d" current={9} required={0} progressLabel="9 / 0" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '1');
  });
});

describe('ChecklistRule', () => {
  it('shows status, evidence and an expandable fix', async () => {
    const { container } = render(
      <ul>
        <ChecklistRule
          status="partial"
          statusLabel="Partly done"
          title="Pinned repos have a README"
          evidence="3 of 5 pinned repos have a README over 600 characters."
          fixLabel="How to fix"
          fix="Add a README to the other two so recruiters know what they are looking at."
        />
        <ChecklistRule status="pass" statusLabel="Passed" title="Profile README" evidence="Found, 412 characters." />
      </ul>,
    );
    expect(screen.getByRole('img', { name: 'Partly done' })).toBeVisible();
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('data-status', 'partial');
    await userEvent.click(screen.getByText('How to fix'));
    expect(screen.getByText(/Add a README to the other two/)).toBeVisible();
    await expectAccessible(container);
  });
});

describe('TerminalWindow', () => {
  it('renders typed lines in a polite live log', async () => {
    const { container } = render(
      <TerminalWindow
        title="commitmates"
        lines={[
          { type: 'command', text: 'commitmates card octocat' },
          { type: 'info', text: 'Reading repos…' },
          { type: 'success', text: 'Done' },
          { type: 'error', text: "We couldn't find @nobody on GitHub." },
        ]}
      >
        <Input label="GitHub username" name="login" />
      </TerminalWindow>,
    );
    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log.querySelector('[data-line="command"]')).toHaveTextContent('$ commitmates card octocat');
    expect(log.querySelectorAll('p')).toHaveLength(4);
    await expectAccessible(container);
  });
});

describe('Radix-based components', () => {
  it('Tabs switch panels with the keyboard', async () => {
    const { container } = render(
      <Tabs
        label="Reviews"
        items={[
          { value: 'open', label: 'Open', content: <p>Open requests</p> },
          { value: 'mine', label: 'Mine', content: <p>My requests</p> },
        ]}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Reviews' })).toBeVisible();
    expect(screen.getByText('Open requests')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Open' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('My requests')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'true');
    await expectAccessible(container);
  });

  it('Dialog opens, names itself and closes', async () => {
    render(
      <Dialog trigger={<Button>Delete account</Button>} title="Delete your account?" description="This cannot be undone." closeLabel="Close">
        <p>Type your username to confirm.</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    await expectAccessible(document.body);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Accordion expands and collapses', async () => {
    const { container } = render(
      <Accordion
        items={[
          { value: 'ai', title: 'Do you use AI?', content: 'No. Every score comes from classic algorithms.' },
          { value: 'data', title: 'Do you sell data?', content: 'Never.' },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Do you use AI?' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/classic algorithms/)).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: 'Do you use AI?' })).toBeVisible();
    await expectAccessible(container);
  });

  it('Tooltip appears on focus', async () => {
    render(
      <Tooltip content="Share of your activity between 22:00 and 04:00">
        <Button variant="ghost">Night share</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('between 22:00 and 04:00');
  });

  it('Popover opens a labelled panel', async () => {
    render(
      <Popover trigger={<Button variant="secondary">How scoring works</Button>} label="How scoring works">
        <p>Scores are per member, so size does not win.</p>
      </Popover>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'How scoring works' }));
    expect(screen.getByRole('dialog', { name: 'How scoring works' })).toHaveTextContent('size does not win');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('DropdownMenu runs the chosen action', async () => {
    const onBlock = vi.fn();
    render(
      <DropdownMenu
        trigger={<Button variant="ghost">More</Button>}
        items={[
          { key: 'mute', label: 'Mute thread', onSelect: vi.fn() },
          { key: 'block', label: 'Block', onSelect: onBlock, danger: true },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu', { name: 'More' })).toBeVisible();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Block' }));
    expect(onBlock).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Toast shows and dismisses a message', async () => {
    function Trigger() {
      const toast = useToast();
      return (
        <Button
          onClick={() => {
            toast({ title: 'Invite link copied', description: 'Share it with a classmate.', tone: 'success' });
          }}
        >
          Copy
        </Button>
      );
    }
    render(
      <ToastProvider label="Notifications" dismissLabel="Dismiss">
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Invite link copied')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Invite link copied')).toBeNull();
  });

  it('useToast explains a missing provider', () => {
    function Lonely() {
      useToast();
      return null;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Lonely />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
