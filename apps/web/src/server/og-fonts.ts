import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Font files for share images. The image renderer reads WOFF, not WOFF2, so it uses the
 * Fontsource packages of the same OFL fonts the site loads through next/font. The files
 * are read from the app's own `node_modules` (the server runs from the app directory) and
 * are listed in `outputFileTracingIncludes` so they ship with the route.
 */
const FONT_FILES = [
  { name: 'Pixelify Sans', weight: 500, file: '@fontsource/pixelify-sans/files/pixelify-sans-latin-500-normal.woff' },
  { name: 'Inter', weight: 400, file: '@fontsource/inter/files/inter-latin-400-normal.woff' },
  { name: 'Inter', weight: 600, file: '@fontsource/inter/files/inter-latin-600-normal.woff' },
] as const;

export type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: 'normal' };

let loaded: Promise<OgFont[]> | undefined;

/** The share-image fonts, read once per server instance. */
export function ogFonts(): Promise<OgFont[]> {
  loaded ??= Promise.all(
    FONT_FILES.map(async (font) => {
      const buffer = await readFile(path.join(process.cwd(), 'node_modules', font.file));
      const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      return { name: font.name, data, weight: font.weight, style: 'normal' as const };
    }),
  ).catch((error: unknown) => {
    // A failed read is retried on the next image instead of being cached.
    loaded = undefined;
    throw error;
  });
  return loaded;
}
