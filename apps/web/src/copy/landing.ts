import type { IconName } from '@commitmates/ui';

export type ToolSlug = 'dev-card' | 'compat' | 'recruiter' | 'fairness' | 'gap' | 'graveyard' | 'oss' | 'fyp-check';

export const landingCopy = {
  hero: {
    eyebrow: 'For student developers',
    title: 'Find your coding partner. Finish what you start.',
    subline:
      'CommitMates reads your real GitHub activity, finds the right partner at your own university, and helps you ship together.',
    primaryCta: 'Try it with your GitHub',
    secondaryCta: 'Sign in',
    companionLabel: 'The CommitMates companion says hello',
    companionLine: 'I learn from your commits, not your claims.',
  },
  demo: {
    eyebrow: 'Live demo',
    title: 'Run it on a real profile',
    intro: 'Type any GitHub username. This runs the real Dev Card on public data, right here.',
    terminalTitle: 'commitmates — demo',
    hint: 'Enter a GitHub username below and press Run.',
    command: (login: string) => `commitmates card ${login}`,
    inputLabel: 'GitHub username',
    run: 'Run',
    runAgain: 'Run again',
    done: 'Card ready. It is just below.',
    companionLabel: (state: string) => `The demo companion is ${state}`,
    fullTool: 'Open the full Dev Card',
  },
  states: {
    eyebrow: 'One companion, five moods',
    title: 'It always tells you what is happening',
    intro: 'Every tool reports through the companion, so you never stare at a spinner and wonder.',
    items: [
      { state: 'idle', label: 'Idle', caption: 'Resting until you ask for something.' },
      { state: 'working', label: 'Working', caption: 'Reading repos and counting, step by step.' },
      { state: 'waiting', label: 'Waiting', caption: 'GitHub asked us to slow down. Back shortly.' },
      { state: 'done', label: 'Done', caption: 'Finished. Your result is ready.' },
      { state: 'error', label: 'Error', caption: 'Something went wrong, and we say what.' },
    ],
    companionLabel: (label: string) => `The companion in its ${label.toLowerCase()} state`,
  },
  tools: {
    eyebrow: 'Day-one tools',
    title: 'Useful before anyone else joins',
    intro: 'Eight tools that work on public GitHub data with nobody else signed up. No account needed.',
    open: 'Open',
    inDevelopment: 'In development',
    items: [
      {
        slug: 'dev-card',
        icon: 'person',
        title: 'Dev Card',
        line: 'Your languages, rhythm and coding personality, with a companion of your own.',
      },
      {
        slug: 'compat',
        icon: 'bolt',
        title: 'Compatibility Check',
        line: 'Two usernames in, an honest breakdown of how you would work together out.',
      },
      {
        slug: 'recruiter',
        icon: 'search',
        title: 'Recruiter-Ready Score',
        line: 'How your profile reads in the first minute, with a fix for every gap.',
      },
      {
        slug: 'fairness',
        icon: 'check_circle',
        title: 'Group Fairness Report',
        line: 'Who contributed what to a team repo, shown neutrally and with evidence.',
      },
      {
        slug: 'gap',
        icon: 'info',
        title: 'Gap Finder',
        line: 'What similar projects usually have that yours does not have yet.',
      },
      {
        slug: 'graveyard',
        icon: 'schedule',
        title: 'Project Graveyard',
        line: 'Inactive projects worth reviving, with a polite way to ask the owner.',
      },
      {
        slug: 'oss',
        icon: 'open_in_new',
        title: 'Open-Source Starter',
        line: 'Beginner issues in your stack, from maintainers who actually reply.',
      },
      {
        slug: 'fyp-check',
        icon: 'terminal',
        title: 'FYP Idea Checker',
        line: 'See how close existing projects are to your final-year project idea.',
      },
    ] satisfies { slug: ToolSlug; icon: IconName; title: string; line: string }[],
  },
  how: {
    eyebrow: 'How it works',
    title: 'Three steps to a real partner',
    steps: [
      {
        title: 'Sign in with GitHub',
        line: 'We ask for read-only access to your public profile and email. Nothing else, ever.',
      },
      {
        title: 'Verify your university',
        line: 'A code to your university email, or two classmates who vouch for you.',
      },
      {
        title: 'Get matched and build',
        line: 'Meet people at your own university whose skills match or complete yours.',
      },
    ],
    stepLabel: (number: number) => `Step ${number}`,
  },
  unlocks: {
    eyebrow: 'Campus unlocks',
    title: 'Features open as your campus joins',
    paragraphs: [
      'Matching, code review exchange and skill swaps need enough verified classmates to be worth using. Until then, each one shows an unlock card: how many members your university has, how many it needs, and a link to invite people.',
      'You never see an empty screen or made-up profiles. If a feature is locked, we tell you exactly what opens it.',
    ],
  },
  privacy: {
    eyebrow: 'Privacy promise',
    title: 'Your data stays yours',
    points: [
      'No AI. Every score comes from classic, explainable algorithms.',
      'No ads, and we never sell or share your data.',
      'We read public GitHub data only. Private repositories are out of scope.',
      'Export everything or delete your account at any time.',
    ],
    link: 'Read the privacy policy',
  },
  faq: {
    eyebrow: 'Questions',
    title: 'Frequently asked',
    items: [
      {
        value: 'cost',
        title: 'Is CommitMates free?',
        content: 'Yes. It is built only on free and open-source software and free service tiers, and there are no paid plans.',
      },
      {
        value: 'access',
        title: 'What can you see on my GitHub?',
        content:
          'Your public profile, public repositories and public activity. We ask GitHub for read-only profile and email access. We cannot read private code and we cannot write to anything.',
      },
      {
        value: 'ai',
        title: 'Do you use AI to score me?',
        content:
          'No. Scores come from counting and comparing: percentiles, similarity measures and weighted rules. Each one is shown with its evidence and a way to improve it.',
      },
      {
        value: 'university',
        title: 'Why do I have to verify my university?',
        content:
          'Matching only works between people who can actually meet and work together. Verification keeps your campus space limited to real classmates.',
      },
      {
        value: 'empty',
        title: 'My GitHub is almost empty. Is this for me?',
        content:
          'Yes. An empty profile is a starting point, not a verdict. The Open-Source Starter and a study partner are good first steps.',
      },
      {
        value: 'delete',
        title: 'Can I delete my account?',
        content: 'Yes, at any time. Deletion removes your data for good; it is not a hidden archive.',
      },
    ],
  },
} as const;
