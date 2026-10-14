import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

/**
 * Pure parsers for dependency manifests (CLAUDE.md §6.6). Each takes file text and
 * returns the direct dependencies it declares. They never throw: a malformed file
 * yields what could be read, or nothing.
 */

export type Ecosystem = 'npm' | 'pypi' | 'crates' | 'pub' | 'packagist' | 'go' | 'maven' | 'rubygems';

export type Dependency = { name: string; isDev: boolean };

export type ParsedManifest = { ecosystem: Ecosystem; dependencies: Dependency[] };

/** Upper bound on dependencies kept per manifest, so one huge file cannot flood the tables. */
const MAX_DEPENDENCIES = 500;
/** Longest package name stored. */
const MAX_NAME_LENGTH = 214;

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);
const bag = (value: unknown): Bag => (isBag(value) ? value : {});

/** Collects dependencies, keeping the first occurrence of each name; runtime wins over dev. */
class Collector {
  private readonly seen = new Map<string, boolean>();

  add(name: string, isDev: boolean): void {
    const clean = name.trim();
    if (clean === '' || clean.length > MAX_NAME_LENGTH || /\s/.test(clean)) return;
    const existing = this.seen.get(clean);
    if (existing === undefined) {
      if (this.seen.size < MAX_DEPENDENCIES) this.seen.set(clean, isDev);
    } else if (existing && !isDev) {
      this.seen.set(clean, false);
    }
  }

  addKeys(table: unknown, isDev: boolean, skip: (name: string) => boolean = () => false): void {
    for (const name of Object.keys(bag(table))) {
      if (!skip(name)) this.add(name, isDev);
    }
  }

  list(): Dependency[] {
    return [...this.seen].map(([name, isDev]) => ({ name, isDev })).sort((a, b) => a.name.localeCompare(b.name));
  }
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- npm

export function parsePackageJson(text: string): Dependency[] {
  const data = bag(safely(() => JSON.parse(text) as unknown, null));
  const out = new Collector();
  out.addKeys(data.dependencies, false);
  out.addKeys(data.peerDependencies, false);
  out.addKeys(data.optionalDependencies, false);
  out.addKeys(data.devDependencies, true);
  return out.list();
}

// ---------------------------------------------------------------- PyPI

/** PEP 503 name normalization: lowercase, runs of `-`, `_` and `.` become one hyphen. */
export function normalizePypiName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** Extracts the project name from a PEP 508 requirement string, or `null` if it has none. */
export function pep508Name(requirement: string): string | null {
  const line = requirement.split('#')[0]?.trim() ?? '';
  // A bare URL has no project name; `name @ https://…` does.
  if (line === '' || line.startsWith('-') || (line.includes('://') && !line.includes('@'))) return null;
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
  return match?.[1] ? normalizePypiName(match[1]) : null;
}

/** File names that mark a requirements file as development-only, e.g. `requirements-dev.txt`. */
const DEV_FILE_HINT = /(^|[-_.])(dev|develop|development|test|tests|testing|docs?|lint|ci)([-_.]|$)/i;
/** Group names in Python manifests that hold development-only dependencies. */
const DEV_GROUP = /^(dev|develop|development|test|tests|testing|docs?|lint|typing|ci|build)$/i;

export function parseRequirementsTxt(text: string, fileName = 'requirements.txt'): Dependency[] {
  const isDev = DEV_FILE_HINT.test(fileName.replace(/^requirements/i, '').replace(/\.txt$/i, ''));
  const out = new Collector();
  // A trailing backslash continues a requirement on the next line.
  for (const line of text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const name = pep508Name(line);
    if (name) out.add(name, isDev);
  }
  return out.list();
}

export function parsePyprojectToml(text: string): Dependency[] {
  const data = bag(safely(() => parseToml(text) as unknown, null));
  const out = new Collector();
  const addRequirements = (list: unknown, isDev: boolean) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      const name = pep508Name(entry);
      if (name) out.add(name, isDev);
    }
  };

  const project = bag(data.project);
  addRequirements(project.dependencies, false);
  for (const [group, list] of Object.entries(bag(project['optional-dependencies']))) {
    addRequirements(list, DEV_GROUP.test(group));
  }
  // PEP 735 dependency groups are development tooling by definition.
  for (const list of Object.values(bag(data['dependency-groups']))) addRequirements(list, true);

  const poetry = bag(bag(data.tool).poetry);
  const isPython = (name: string) => name.toLowerCase() === 'python';
  for (const name of Object.keys(bag(poetry.dependencies))) {
    if (!isPython(name)) out.add(normalizePypiName(name), false);
  }
  for (const name of Object.keys(bag(poetry['dev-dependencies']))) out.add(normalizePypiName(name), true);
  for (const group of Object.values(bag(poetry.group))) {
    for (const name of Object.keys(bag(bag(group).dependencies))) out.add(normalizePypiName(name), true);
  }
  return out.list();
}

export function parsePipfile(text: string): Dependency[] {
  const data = bag(safely(() => parseToml(text) as unknown, null));
  const out = new Collector();
  for (const name of Object.keys(bag(data.packages))) out.add(normalizePypiName(name), false);
  for (const name of Object.keys(bag(data['dev-packages']))) out.add(normalizePypiName(name), true);
  return out.list();
}

/** Reads `setup.cfg` (INI): `install_requires` under `[options]` and every list under `[options.extras_require]`. */
export function parseSetupCfg(text: string): Dependency[] {
  const out = new Collector();
  let section = '';
  let key = '';
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*[#;]/.test(raw) || raw.trim() === '') continue;
    const header = /^\[([^\]]+)\]\s*$/.exec(raw);
    if (header?.[1]) {
      section = header[1].trim();
      key = '';
      continue;
    }
    const assignment = /^([A-Za-z0-9_.-]+)\s*[=:]\s*(.*)$/.exec(raw);
    let value: string;
    if (assignment?.[1] !== undefined && !/^\s/.test(raw)) {
      key = assignment[1];
      value = assignment[2] ?? '';
    } else {
      value = raw;
    }
    const wanted =
      (section === 'options' && key === 'install_requires') ||
      (section === 'options' && key === 'tests_require') ||
      section === 'options.extras_require';
    if (!wanted) continue;
    const isDev = section === 'options.extras_require' || key === 'tests_require';
    for (const part of value.split(';')[0]?.split(',') ?? []) {
      const name = pep508Name(part);
      if (name) out.add(name, isDev);
    }
  }
  return out.list();
}

// ---------------------------------------------------------------- pub.dev

export function parsePubspecYaml(text: string): Dependency[] {
  const data = bag(safely(() => parseYaml(text) as unknown, null));
  const out = new Collector();
  // `flutter: { sdk: flutter }` and friends come from the SDK, not from pub.dev.
  const add = (table: unknown, isDev: boolean) => {
    for (const [name, spec] of Object.entries(bag(table))) {
      if (isBag(spec) && 'sdk' in spec) continue;
      out.add(name, isDev);
    }
  };
  add(data.dependencies, false);
  add(data.dev_dependencies, true);
  return out.list();
}

// ---------------------------------------------------------------- crates.io

export function parseCargoToml(text: string): Dependency[] {
  const data = bag(safely(() => parseToml(text) as unknown, null));
  const out = new Collector();
  // `alias = { package = "real-name" }` renames a crate locally; the registry name is `package`.
  const add = (table: unknown, isDev: boolean) => {
    for (const [name, spec] of Object.entries(bag(table))) {
      const real = isBag(spec) && typeof spec.package === 'string' ? spec.package : name;
      out.add(real, isDev);
    }
  };
  const addTables = (source: Bag) => {
    add(source.dependencies, false);
    add(source['build-dependencies'], false);
    add(source['dev-dependencies'], true);
  };
  addTables(data);
  add(bag(data.workspace).dependencies, false);
  for (const target of Object.values(bag(data.target))) addTables(bag(target));
  return out.list();
}

// ---------------------------------------------------------------- Go

export function parseGoMod(text: string): Dependency[] {
  const out = new Collector();
  let inRequire = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('require (')) {
      inRequire = true;
      continue;
    }
    if (inRequire && line.startsWith(')')) {
      inRequire = false;
      continue;
    }
    const body = inRequire ? line : /^require\s+(.+)$/.exec(line)?.[1];
    if (!body) continue;
    // Indirect requirements are other modules' dependencies, not this project's choices.
    if (/\/\/\s*indirect/.test(body)) continue;
    const modulePath = /^([^\s]+)\s+v\S+/.exec(body)?.[1];
    if (modulePath) out.add(modulePath, false);
  }
  return out.list();
}

// ---------------------------------------------------------------- Packagist

/** `php`, `ext-*`, `lib-*` and `composer-*` are platform requirements, not packages. */
const COMPOSER_PLATFORM = /^(php(-.*)?|hhvm|ext-.+|lib-.+|composer(-.+)?)$/i;

export function parseComposerJson(text: string): Dependency[] {
  const data = bag(safely(() => JSON.parse(text) as unknown, null));
  const out = new Collector();
  const skip = (name: string) => COMPOSER_PLATFORM.test(name) || !name.includes('/');
  out.addKeys(data.require, false, skip);
  out.addKeys(data['require-dev'], true, skip);
  return out.list().map((dependency) => ({ ...dependency, name: dependency.name.toLowerCase() }));
}

// ---------------------------------------------------------------- RubyGems

/** Bundler groups that hold development-only gems. */
const RUBY_DEV_GROUP = /:(development|test|doc|docs|lint|ci)\b/;

export function parseGemfile(text: string): Dependency[] {
  const out = new Collector();
  // Stack of open blocks; `true` marks a development group.
  const blocks: boolean[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    if (line === 'end') {
      blocks.pop();
      continue;
    }
    const group = /^group\s+(.+?)\s+do\b/.exec(line);
    if (group?.[1] !== undefined) {
      blocks.push(RUBY_DEV_GROUP.test(group[1]));
      continue;
    }
    const gem = /^gem\s*\(?\s*["']([^"']+)["'](.*)$/.exec(line);
    if (gem?.[1] !== undefined) {
      const inline = /group:?\s*(=>)?\s*(\[[^\]]*\]|:\w+)/.exec(gem[2] ?? '')?.[2] ?? '';
      out.add(gem[1], blocks.some(Boolean) || RUBY_DEV_GROUP.test(inline));
      continue;
    }
    // Any other block opener (platforms, source, install_if) must be balanced with its `end`.
    if (/\bdo\b(\s*\|[^|]*\|)?$/.test(line)) blocks.push(false);
  }
  return out.list();
}

// ---------------------------------------------------------------- Maven and Gradle

const tag = (block: string, name: string): string | null =>
  new RegExp(`<${name}>\\s*([^<\\s][^<]*?)\\s*</${name}>`).exec(block)?.[1] ?? null;

export function parsePomXml(text: string): Dependency[] {
  const out = new Collector();
  // Plugins declare their own <dependencies>; they are build tooling, not project dependencies.
  const withoutPlugins = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<plugins>[\s\S]*?<\/plugins>/g, '');
  for (const match of withoutPlugins.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = match[1] ?? '';
    const group = tag(block, 'groupId');
    const artifact = tag(block, 'artifactId');
    // Coordinates built from properties (`${project.groupId}`) cannot be resolved here.
    if (!group || !artifact || group.includes('$') || artifact.includes('$')) continue;
    out.add(`${group}:${artifact}`, tag(block, 'scope') === 'test');
  }
  return out.list();
}

/** Gradle configurations that declare dependencies; ones starting with "test" are development-only. */
const GRADLE_CONFIGURATION =
  /^\s*(?:"|')?([A-Za-z]*(?:[Ii]mplementation|[Aa]pi|[Cc]ompileOnly|[Rr]untimeOnly|[Cc]ompile|[Rr]untime|kapt|ksp|[Aa]nnotationProcessor|classpath))(?:"|')?\s*\(?\s*(.*)$/;
const GRADLE_COORDINATE = /["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::[^"']*)?["']/;
const GRADLE_MAP = /group\s*[:=]\s*["']([^"']+)["']\s*,\s*name\s*[:=]\s*["']([^"']+)["']/;
const GRADLE_DEV = /^(test|androidTest|debug)/;

export function parseBuildGradle(text: string): Dependency[] {
  const out = new Collector();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '');
    const declaration = GRADLE_CONFIGURATION.exec(line);
    if (declaration?.[1] === undefined) continue;
    const rest = declaration[2] ?? '';
    const coordinate = GRADLE_COORDINATE.exec(rest) ?? GRADLE_MAP.exec(rest);
    if (coordinate?.[1] && coordinate[2]) {
      out.add(`${coordinate[1]}:${coordinate[2]}`, GRADLE_DEV.test(declaration[1]));
    }
  }
  return out.list();
}

// ---------------------------------------------------------------- registry of manifest files

type ManifestKind = { ecosystem: Ecosystem; parse: (text: string, fileName: string) => Dependency[] };

function kindFor(fileName: string): ManifestKind | null {
  const name = fileName.toLowerCase();
  if (name === 'package.json') return { ecosystem: 'npm', parse: parsePackageJson };
  if (/^requirements([-_.][a-z0-9_.-]*)?\.txt$/.test(name)) return { ecosystem: 'pypi', parse: parseRequirementsTxt };
  if (name === 'pyproject.toml') return { ecosystem: 'pypi', parse: parsePyprojectToml };
  if (name === 'pipfile') return { ecosystem: 'pypi', parse: parsePipfile };
  if (name === 'setup.cfg') return { ecosystem: 'pypi', parse: parseSetupCfg };
  if (name === 'pubspec.yaml') return { ecosystem: 'pub', parse: parsePubspecYaml };
  if (name === 'cargo.toml') return { ecosystem: 'crates', parse: parseCargoToml };
  if (name === 'go.mod') return { ecosystem: 'go', parse: parseGoMod };
  if (name === 'composer.json') return { ecosystem: 'packagist', parse: parseComposerJson };
  if (name === 'gemfile') return { ecosystem: 'rubygems', parse: parseGemfile };
  if (name === 'pom.xml') return { ecosystem: 'maven', parse: parsePomXml };
  if (name === 'build.gradle' || name === 'build.gradle.kts') return { ecosystem: 'maven', parse: parseBuildGradle };
  return null;
}

/** True when a file name (not a path) is a manifest we can read. */
export function isManifestFile(fileName: string): boolean {
  return kindFor(fileName) !== null;
}

export function manifestEcosystem(fileName: string): Ecosystem | null {
  return kindFor(fileName)?.ecosystem ?? null;
}

/** Parses a manifest by its file name. Returns `null` for files that are not manifests. */
export function parseManifest(fileName: string, text: string): ParsedManifest | null {
  const kind = kindFor(fileName);
  if (!kind) return null;
  return { ecosystem: kind.ecosystem, dependencies: safely(() => kind.parse(text, fileName), []) };
}
