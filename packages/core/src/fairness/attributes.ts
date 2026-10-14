/**
 * `.gitattributes` rules that mark paths as vendored, generated or documentation for Linguist
 * (CLAUDE.md §8 F4 "Data" step 4). Patterns come from the repository being analyzed, so they
 * are turned into regular expressions here, character by character, never passed through.
 */

const LINGUIST_ATTRIBUTES = ['linguist-vendored', 'linguist-generated', 'linguist-documentation'];

/** Converts one gitattributes pattern (gitignore-style glob) to an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  let glob = pattern.trim();
  const anchored = glob.startsWith('/') || glob.slice(0, -1).includes('/');
  glob = glob.replace(/^\//, '');
  const directory = glob.endsWith('/');
  if (directory) glob = glob.slice(0, -1);

  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index] ?? '';
    if (character === '*') {
      if (glob.startsWith('**', index)) {
        // `**/` matches any number of directories; a trailing `**` matches everything below.
        const token = glob.startsWith('**/', index) ? '**/' : '**';
        source += token === '**/' ? '(?:.*/)?' : '.*';
        index += token.length - 1;
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  // A pattern without a slash matches a name at any depth; a directory also covers what is inside.
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}${directory ? '/.*' : '(?:/.*)?'}$`);
}

/** The patterns whose Linguist attributes are set (not unset with `-` or `=false`). */
export function linguistExclusionPatterns(gitattributes: string): RegExp[] {
  const patterns: RegExp[] = [];
  for (const raw of gitattributes.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const [pattern, ...attributes] = line.split(/\s+/);
    if (!pattern) continue;
    const marks = attributes.some((attribute) => {
      const [name, value] = attribute.split('=');
      return name !== undefined && LINGUIST_ATTRIBUTES.includes(name) && value !== 'false';
    });
    if (marks) patterns.push(globToRegExp(pattern));
  }
  return patterns;
}
