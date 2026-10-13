export const healthCopy = {
  metaTitle: 'Service status',
  title: 'Service status',
  intro: 'Live values from the server that rendered this page.',
  status: { label: 'Status', ok: 'Running' },
  version: 'Version',
  commit: { label: 'Commit', unknown: 'Not reported by this host' },
  serverTime: 'Server time (UTC)',
} as const;
