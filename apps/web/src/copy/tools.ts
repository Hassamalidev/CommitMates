export const toolsCopy = {
  job: {
    idleChip: 'Idle',
    workingChip: 'Working',
    waitingChip: 'Waiting',
    doneChip: 'Done',
    errorChip: 'Error',
    queued: 'Getting ready…',
    stepOf: (position: number, total: number) => `(step ${position} of ${total})`,
    waiting: (minutes: number) =>
      `GitHub asked us to slow down — back in about ${minutes} min. You can leave; we'll keep going.`,
    done: 'Done. Here is what we found.',
    stepsLabel: 'Progress',
    companionLabel: (state: string) => `The companion is ${state}`,
    states: { idle: 'idle', working: 'working', waiting: 'waiting', done: 'done', error: 'showing an error' },
  },
  errors: {
    network: "We couldn't reach the server. Check your connection and try again.",
    unexpected: 'Something broke on our side. Please try again.',
    lostConnection: 'We lost the connection while working. Try again; finished work is kept.',
    invalidBody: 'That request was not valid. Please try again.',
    crossSite: 'That request did not come from this site.',
    unknownTool: 'We do not have a tool by that name.',
    failed: (reference: string) => `Something broke on our side. We've logged it (ref: ${reference}).`,
  },
  page: {
    saveTitle: 'Save and share',
    saveLine: 'Sign in to keep this result on your profile and share it.',
    saveAction: 'Sign in',
    nextTitle: 'Try next',
    open: 'Open',
  },
} as const;
