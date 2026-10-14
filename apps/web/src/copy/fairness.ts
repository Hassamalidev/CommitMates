const percent = (value: number) => `${Math.round(value * 100)}%`;

export const fairnessCopy = {
  meta: {
    title: 'Group Fairness Report',
    description: 'A neutral, evidence-based picture of who contributed what code to a team repository.',
  },
  page: {
    eyebrow: 'Day-one tool',
    title: 'Group Fairness Report',
    line: 'Paste a team repository and see how the code work was shared, week by week, without blaming anyone.',
  },
  form: {
    title: 'Which repository?',
    label: 'GitHub repository link',
    description: 'Public repositories only, for example https://github.com/team/project.',
    submit: 'Build report',
    again: 'Build again',
  },
  idleLine: 'Give me a team repository and I will count the code, neutrally.',
  /** Keys match the steps the `fairness_report` job reports. */
  steps: [
    { key: 'repo', label: 'Opening the repository' },
    { key: 'stats', label: 'Reading contributor statistics' },
    { key: 'commits', label: 'Reading commits' },
    { key: 'lines', label: 'Counting lines' },
    { key: 'building', label: 'Building the report' },
  ],
  result: {
    heading: (repo: string) => `Code contribution report for ${repo}`,
    metricLabel: 'Measure',
    metrics: { commits: 'Commits', lines: 'Lines changed' },
    linesUnavailable: 'Line counts are not available for everyone in this repository, so the report counts commits.',
    includeBots: 'Include bots',
    sharesTitle: 'Who did what',
    sharesLabel: (metric: string) => `Share of ${metric.toLowerCase()} per person`,
    personHeading: 'Person',
    shareHeading: 'Share',
    shareValue: (share: number, value: number, metric: 'commits' | 'lines') =>
      `${percent(share)} · ${Math.round(value).toLocaleString('en')} ${metric === 'commits' ? (value === 1 ? 'commit' : 'commits') : 'lines'}`,
    unlinked: 'no GitHub account',
    teamTitle: 'Team picture',
    gini: (value: number) => `Inequality (Gini): ${value.toFixed(2)}. 0 means perfectly even; values near 1 mean one person did nearly everything.`,
    leastShare: (value: number) => `The smallest share is ${percent(value)} of an equal split.`,
    flagged: (threshold: number) => `Contribution is uneven: the smallest share is below ${percent(threshold)} of an equal split.`,
    balanced: 'No one is far below an equal share.',
    single: 'Only one person contributed code, so there is nothing to compare.',
    late: (count: number, window: number) =>
      `${count} ${count === 1 ? 'person made' : 'people made'} most of their commits in the final ${percent(window)} of the project.`,
    timelineTitle: 'Week by week',
    timelineLabel: 'Commits per person per week',
    notVisible: 'Design, writing, testing outside the repository and meetings are not visible here. Talk it through as a team.',
    excluded: (lines: number) => `Left out ${lines.toLocaleString('en')} lines in generated, vendored or documentation files.`,
    commitsOnly: (count: number) => 'This repository is too large for GitHub’s statistics, so the report uses the latest ' + `${count.toLocaleString('en')} commits.`,
    coAuthors: (count: number) => `${count} co-author ${count === 1 ? 'credit' : 'credits'} from “Co-authored-by” lines.`,
  },
  merge: {
    title: 'Same person, different names?',
    line: 'Commits made without a GitHub account show up under their name. Merge them into the right person; the report updates here and is not saved.',
    into: (name: string) => `Merge ${name} into`,
    keep: 'Keep separate',
    commits: (count: number) => `${count} ${count === 1 ? 'commit' : 'commits'}`,
  },
} as const;
