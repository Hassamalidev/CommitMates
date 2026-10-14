import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isManifestFile,
  manifestEcosystem,
  normalizePypiName,
  parseBuildGradle,
  parseCargoToml,
  parseComposerJson,
  parseGemfile,
  parseGoMod,
  parseManifest,
  parsePackageJson,
  parsePipfile,
  parsePomXml,
  parsePubspecYaml,
  parsePyprojectToml,
  parseRequirementsTxt,
  parseSetupCfg,
  pep508Name,
  type Dependency,
} from './parsers';

// Real manifests recorded from well-known public repositories (see __fixtures__/manifests/README.md).
const fixture = (name: string) => readFileSync(new URL(`../__fixtures__/manifests/${name}`, import.meta.url), 'utf8');

const names = (dependencies: Dependency[], dev?: boolean) =>
  dependencies.filter((dependency) => dev === undefined || dependency.isDev === dev).map((dependency) => dependency.name);

const MALFORMED = ['', '   ', '{', '<<<>>>', '[unclosed', 'null', '\u0000\u0001 binary', 'key: [unterminated'];

describe('package.json (expressjs/express)', () => {
  const dependencies = parsePackageJson(fixture('package.json'));

  it('separates runtime and development dependencies', () => {
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['body-parser', 'cookie', 'debug', 'qs']));
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['mocha', 'supertest', 'eslint']));
    expect(names(dependencies, false)).not.toContain('mocha');
  });

  it('reads peer and optional dependencies, sorted and unique', () => {
    const parsed = parsePackageJson(
      JSON.stringify({
        dependencies: { react: '^19', '@scope/pkg': '1' },
        peerDependencies: { react: '*' },
        optionalDependencies: { fsevents: '*' },
        devDependencies: { react: '*', vitest: '*' },
      }),
    );
    expect(parsed).toEqual([
      { name: '@scope/pkg', isDev: false },
      { name: 'fsevents', isDev: false },
      { name: 'react', isDev: false },
      { name: 'vitest', isDev: true },
    ]);
  });
});

describe('Python requirement names', () => {
  it('normalizes per PEP 503', () => {
    expect(normalizePypiName('Flask_SQLAlchemy')).toBe('flask-sqlalchemy');
    expect(normalizePypiName('zope.interface')).toBe('zope-interface');
  });

  it('extracts the name from PEP 508 strings', () => {
    expect(pep508Name('requests[socks]>=2.0 ; python_version < "3.11"')).toBe('requests');
    expect(pep508Name('Django==5.0  # pinned')).toBe('django');
    expect(pep508Name('pkg @ https://example.com/pkg.whl')).toBe('pkg');
    for (const line of ['', '# comment', '-r base.txt', '-e .[socks]', '--index-url https://x', 'https://x/y.whl']) {
      expect(pep508Name(line), line).toBeNull();
    }
  });
});

describe('requirements.txt (psf/requests)', () => {
  it('reads names and treats a dev file as development-only', () => {
    const dependencies = parseRequirementsTxt(fixture('requirements-dev.txt'), 'requirements-dev.txt');
    expect(names(dependencies)).toEqual(['httpbin', 'pytest', 'pytest-cov', 'pytest-httpbin', 'trustme', 'wheel']);
    expect(dependencies.every((dependency) => dependency.isDev)).toBe(true);
  });

  it('treats plain requirements as runtime and joins continued lines', () => {
    const text = 'numpy>=1.20 \\\n    --hash=sha256:abc\nPandas\n\n# comment\n-r other.txt\n';
    expect(parseRequirementsTxt(text, 'requirements.txt')).toEqual([
      { name: 'numpy', isDev: false },
      { name: 'pandas', isDev: false },
    ]);
    expect(parseRequirementsTxt('pytest', 'requirements_test.txt')[0]?.isDev).toBe(true);
    expect(parseRequirementsTxt('flask', 'requirements-prod.txt')[0]?.isDev).toBe(false);
  });
});

describe('pyproject.toml', () => {
  it('reads PEP 621 dependencies and groups (pallets/flask)', () => {
    const dependencies = parsePyprojectToml(fixture('pyproject.toml'));
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['werkzeug', 'jinja2', 'click', 'itsdangerous']));
    expect(names(dependencies, true).length).toBeGreaterThan(0);
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['pytest']));
  });

  it('reads Poetry tables and skips python itself (python-poetry/poetry)', () => {
    const dependencies = parsePyprojectToml(fixture('poetry-pyproject.toml'));
    expect(names(dependencies)).not.toContain('python');
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['poetry-core', 'requests']));
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['pytest', 'mypy']));
  });

  it('marks optional groups as development only when their name says so', () => {
    const text = [
      '[project]',
      'dependencies = ["httpx>=0.27"]',
      '[project.optional-dependencies]',
      'postgres = ["psycopg[binary]"]',
      'test = ["pytest"]',
      '[tool.poetry.dev-dependencies]',
      'Black = "*"',
    ].join('\n');
    expect(parsePyprojectToml(text)).toEqual([
      { name: 'black', isDev: true },
      { name: 'httpx', isDev: false },
      { name: 'psycopg', isDev: false },
      { name: 'pytest', isDev: true },
    ]);
  });
});

describe('Pipfile (pypa/pipenv)', () => {
  it('reads packages and dev-packages', () => {
    const dependencies = parsePipfile(fixture('Pipfile'));
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['sphinx', 'pytest-cov', 'myst-parser', 'pyyaml']));
    expect(parsePipfile('[packages]\nFlask = "*"\n[dev-packages]\npytest = "*"\n')).toEqual([
      { name: 'flask', isDev: false },
      { name: 'pytest', isDev: true },
    ]);
  });
});

describe('setup.cfg (pandas-dev/pandas)', () => {
  it('reads multi-line install_requires and extras', () => {
    const dependencies = parseSetupCfg(fixture('setup.cfg'));
    expect(names(dependencies, false)).toEqual(['numpy', 'python-dateutil', 'pytz']);
    expect(names(dependencies, true)).toEqual(['hypothesis', 'pytest', 'pytest-xdist']);
  });

  it('ignores other sections and keys', () => {
    const text = '[metadata]\nname = demo\n[options]\npackages = find:\ninstall_requires = requests, Click>=8\n[flake8]\nignore = E501\n';
    expect(names(parseSetupCfg(text))).toEqual(['click', 'requests']);
  });
});

describe('pubspec.yaml (flutter/gallery)', () => {
  it('reads pub packages and skips SDK dependencies', () => {
    const dependencies = parsePubspecYaml(fixture('pubspec.yaml'));
    expect(names(dependencies)).not.toContain('flutter');
    expect(names(dependencies)).not.toContain('flutter_test');
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['provider', 'url_launcher']));
    expect(names(dependencies, true).length).toBeGreaterThan(0);
  });
});

describe('Cargo.toml (BurntSushi/ripgrep)', () => {
  it('reads dependencies, dev-dependencies and target tables', () => {
    const dependencies = parseCargoToml(fixture('Cargo.toml'));
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['anyhow', 'grep', 'ignore', 'serde_json']));
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['serde', 'walkdir']));
  });

  it('uses the registry name of a renamed crate and reads workspace dependencies', () => {
    const text = '[dependencies]\njson = { package = "serde_json", version = "1" }\n[workspace.dependencies]\ntokio = "1"\n[target."cfg(unix)".dependencies]\nlibc = "0.2"\n';
    expect(names(parseCargoToml(text))).toEqual(['libc', 'serde_json', 'tokio']);
  });
});

describe('go.mod (gin-gonic/gin)', () => {
  it('reads direct requirements and skips indirect ones', () => {
    const dependencies = parseGoMod(fixture('go.mod'));
    expect(names(dependencies)).toEqual(
      expect.arrayContaining(['github.com/gin-contrib/sse', 'golang.org/x/net', 'google.golang.org/protobuf']),
    );
    expect(names(dependencies)).not.toContain('github.com/bytedance/gopkg');
    expect(dependencies.every((dependency) => !dependency.isDev)).toBe(true);
  });

  it('reads single-line requirements', () => {
    expect(names(parseGoMod('module x\n\nrequire github.com/a/b v1.2.3\nrequire github.com/c/d v0.1.0 // indirect\n'))).toEqual([
      'github.com/a/b',
    ]);
  });
});

describe('composer.json (laravel/laravel)', () => {
  it('reads packages and skips platform requirements', () => {
    const dependencies = parseComposerJson(fixture('composer.json'));
    expect(names(dependencies)).not.toContain('php');
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['laravel/framework']));
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['phpunit/phpunit']));
  });

  it('skips extensions and lowercases names', () => {
    const text = JSON.stringify({ require: { php: '^8.2', 'ext-json': '*', 'Monolog/Monolog': '^3' }, 'require-dev': { 'lib-curl': '*' } });
    expect(parseComposerJson(text)).toEqual([{ name: 'monolog/monolog', isDev: false }]);
  });
});

describe('Gemfile (jekyll/jekyll)', () => {
  it('reads gems and marks development and test groups', () => {
    const dependencies = parseGemfile(fixture('Gemfile'));
    expect(names(dependencies, false)).toEqual(expect.arrayContaining(['rake']));
    expect(names(dependencies, true)).toEqual(expect.arrayContaining(['rspec', 'rubocop', 'cucumber']));
  });

  it('handles nested blocks, inline groups and comments', () => {
    const text = [
      "source 'https://rubygems.org'",
      "gem 'rails', '~> 8.0' # the framework",
      'group :development, :test do',
      "  gem 'rspec-rails'",
      '  platforms :mri do',
      "    gem 'byebug'",
      '  end',
      'end',
      "gem 'rubocop', group: :development",
      "gem 'pg'",
    ].join('\n');
    expect(parseGemfile(text)).toEqual([
      { name: 'byebug', isDev: true },
      { name: 'pg', isDev: false },
      { name: 'rails', isDev: false },
      { name: 'rspec-rails', isDev: true },
      { name: 'rubocop', isDev: true },
    ]);
  });
});

describe('pom.xml (spring-projects/spring-petclinic)', () => {
  it('reads group:artifact pairs and test scope, ignoring plugin dependencies', () => {
    const dependencies = parsePomXml(fixture('pom.xml'));
    expect(names(dependencies, false)).toEqual(
      expect.arrayContaining(['org.springframework.boot:spring-boot-starter-data-jpa', 'com.h2database:h2']),
    );
    expect(names(dependencies, true)).toEqual(
      expect.arrayContaining(['org.springframework.boot:spring-boot-starter-webmvc-test', 'org.testcontainers:testcontainers-mysql']),
    );
    expect(names(dependencies).some((name) => name.includes('checkstyle'))).toBe(false);
  });

  it('skips coordinates built from properties', () => {
    const text = '<dependencies><dependency><groupId>${project.groupId}</groupId><artifactId>core</artifactId></dependency><dependency><groupId>a.b</groupId><artifactId>c</artifactId></dependency></dependencies>';
    expect(names(parsePomXml(text))).toEqual(['a.b:c']);
  });
});

describe('build.gradle', () => {
  it('reads Groovy string coordinates (spring-projects/spring-petclinic)', () => {
    const dependencies = parseBuildGradle(fixture('build.gradle'));
    expect(names(dependencies, false)).toEqual(
      expect.arrayContaining(['org.springframework.boot:spring-boot-starter-cache', 'javax.cache:cache-api']),
    );
    expect(names(dependencies, true)).toEqual(
      expect.arrayContaining(['org.springframework.boot:spring-boot-starter-webmvc-test', 'org.testcontainers:testcontainers-mysql']),
    );
  });

  it('reads Kotlin DSL calls and map notation', () => {
    const text = [
      'dependencies {',
      '    implementation("com.squareup.okio:okio:3.9.0") // io',
      '    api("org.jetbrains.kotlin:kotlin-stdlib")',
      "    testImplementation group: 'junit', name: 'junit', version: '4.13'",
      '    androidTestImplementation("androidx.test:runner:1.5.0")',
      '    implementation(project(":core"))',
      '    implementation(libs.some.alias)',
      '}',
    ].join('\n');
    expect(parseBuildGradle(text)).toEqual([
      { name: 'androidx.test:runner', isDev: true },
      { name: 'com.squareup.okio:okio', isDev: false },
      { name: 'junit:junit', isDev: true },
      { name: 'org.jetbrains.kotlin:kotlin-stdlib', isDev: false },
    ]);
  });

  it('yields nothing for a build that only uses version catalogs (square/okhttp)', () => {
    expect(parseBuildGradle(fixture('build.gradle.kts'))).toEqual([]);
  });
});

describe('malformed input', () => {
  const parsers = {
    parsePackageJson,
    parseRequirementsTxt,
    parsePyprojectToml,
    parsePipfile,
    parseSetupCfg,
    parsePubspecYaml,
    parseCargoToml,
    parseGoMod,
    parseComposerJson,
    parseGemfile,
    parsePomXml,
    parseBuildGradle,
  };

  it.each(Object.entries(parsers))('%s never throws and returns a list', (_name, parse) => {
    for (const text of MALFORMED) {
      const result = parse(text);
      expect(Array.isArray(result)).toBe(true);
      expect(result.every((dependency) => dependency.name.length > 0 && !/\s/.test(dependency.name))).toBe(true);
    }
  });

  it('tolerates wrong shapes inside valid files', () => {
    expect(parsePackageJson('{"dependencies": ["not", "an", "object"], "devDependencies": 5}')).toEqual([]);
    expect(parsePackageJson('[1,2,3]')).toEqual([]);
    expect(parsePyprojectToml('[project]\ndependencies = "requests"\n')).toEqual([]);
    expect(parsePubspecYaml('dependencies: just-a-string')).toEqual([]);
    expect(parseCargoToml('dependencies = 3')).toEqual([]);
  });

  it('caps the number of dependencies and drops absurd names', () => {
    const many = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [`pkg-${index}`, '*']));
    expect(parsePackageJson(JSON.stringify({ dependencies: many }))).toHaveLength(500);
    expect(parsePackageJson(JSON.stringify({ dependencies: { ['x'.repeat(300)]: '*', 'has space': '*', ok: '*' } }))).toEqual([
      { name: 'ok', isDev: false },
    ]);
  });
});

describe('manifest registry', () => {
  it('recognizes manifest file names case-insensitively', () => {
    for (const name of [
      'package.json',
      'requirements.txt',
      'requirements-dev.txt',
      'requirements_test.txt',
      'pyproject.toml',
      'Pipfile',
      'setup.cfg',
      'pubspec.yaml',
      'Cargo.toml',
      'go.mod',
      'composer.json',
      'Gemfile',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
    ]) {
      expect(isManifestFile(name), name).toBe(true);
    }
    for (const name of ['README.md', 'package-lock.json', 'requirements.in', 'Cargo.lock', 'go.sum', 'settings.gradle']) {
      expect(isManifestFile(name), name).toBe(false);
    }
  });

  it('maps files to ecosystems and parses by name', () => {
    expect(manifestEcosystem('Cargo.toml')).toBe('crates');
    expect(manifestEcosystem('build.gradle.kts')).toBe('maven');
    expect(manifestEcosystem('nope.txt')).toBeNull();
    expect(parseManifest('go.mod', 'require github.com/a/b v1.0.0')).toEqual({
      ecosystem: 'go',
      dependencies: [{ name: 'github.com/a/b', isDev: false }],
    });
    expect(parseManifest('requirements-dev.txt', 'pytest')).toEqual({
      ecosystem: 'pypi',
      dependencies: [{ name: 'pytest', isDev: true }],
    });
    expect(parseManifest('notes.txt', 'x')).toBeNull();
  });
});
