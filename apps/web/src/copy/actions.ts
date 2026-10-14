export const actionsCopy = {
  invalidInput: 'Some of that input is not valid. Please check it and try again.',
  unexpected: (reference: string) => `Something broke on our side. We've logged it (ref: ${reference}).`,
} as const;
