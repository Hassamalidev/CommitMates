import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// `waitFor` and `findBy*` give up after 1 s by default; a full `pnpm verify` runs every
// package at once and a render can take longer than that on a busy machine.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
