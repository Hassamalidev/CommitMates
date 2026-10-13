import ts from 'typescript';

/**
 * Finds unexplained literals (CLAUDE.md §2.3, §10.12): numbers greater than 1 and
 * arrays of three or more strings. A literal is explained when it
 *   - belongs to a documented SCREAMING_SNAKE constant (a comment sits above it), or
 *   - carries `// allowed-literal: <reason>` on its own line or the line above.
 * Everything else belongs in the Settings Engine.
 */

export type HardcodedFinding = {
  file: string;
  line: number;
  column: number;
  kind: 'number' | 'string-array';
  text: string;
};

/** Numbers up to this value (0, 1, fractions used as identities) are never flagged. */
const MAX_UNFLAGGED_NUMBER = 1;
/** String arrays shorter than this are not treated as vocabularies. */
const MIN_FLAGGED_ARRAY_LENGTH = 3;
/** Longest literal excerpt shown in a finding. */
const EXCERPT_LENGTH = 60;

const ALLOW_COMMENT = /\/\/\s*allowed-literal:\s*\S+/;
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassLike(node);
}

function hasLeadingComment(statement: ts.Node, source: string): boolean {
  const ranges = ts.getLeadingCommentRanges(source, statement.getFullStart());
  return ranges !== undefined && ranges.length > 0;
}

/** True when the node sits inside `const NAME = …` that is documented by a comment. */
function inDocumentedConstant(node: ts.Node, source: string): boolean {
  for (let current = node.parent as ts.Node | undefined; current; current = current.parent) {
    if (isFunctionBoundary(current)) return false;
    if (!ts.isVariableDeclaration(current)) continue;
    if (!ts.isIdentifier(current.name) || !CONSTANT_NAME.test(current.name.text)) return false;
    const list = current.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return false;
    return hasLeadingComment(list.parent, source);
  }
  return false;
}

function hasAllowComment(node: ts.Node, sourceFile: ts.SourceFile, lines: readonly string[]): boolean {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  if (ALLOW_COMMENT.test(lines[line] ?? '')) return true;
  const previous = (lines[line - 1] ?? '').trim();
  return previous.startsWith('//') && ALLOW_COMMENT.test(previous);
}

export function findHardcoded(file: string, source: string): HardcodedFinding[] {
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = source.split(/\r?\n/);
  const findings: HardcodedFinding[] = [];

  const report = (node: ts.Node, kind: HardcodedFinding['kind']) => {
    if (inDocumentedConstant(node, source) || hasAllowComment(node, sourceFile, lines)) return;
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      file,
      line: position.line + 1,
      column: position.character + 1,
      kind,
      text: node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, EXCERPT_LENGTH),
    });
  };

  const visit = (node: ts.Node) => {
    // Literal types and enum members are schema, not behavior.
    if (ts.isTypeNode(node) || ts.isEnumDeclaration(node)) return;

    if (ts.isNumericLiteral(node) && Number(node.text) > MAX_UNFLAGGED_NUMBER) {
      report(node, 'number');
    } else if (
      ts.isArrayLiteralExpression(node) &&
      node.elements.length >= MIN_FLAGGED_ARRAY_LENGTH &&
      node.elements.every((element) => ts.isStringLiteralLike(element))
    ) {
      report(node, 'string-array');
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

const SKIPPED_PATH = /(\.test\.tsx?$|\.d\.ts$|[\\/]__tests__[\\/]|[\\/]__fixtures__[\\/])/;

/** Only production source is checked; tests and fixtures may use any literal. */
export function isCheckedFile(file: string): boolean {
  return /\.tsx?$/.test(file) && !SKIPPED_PATH.test(file);
}

export function formatHardcodedFinding(finding: HardcodedFinding): string {
  const what = finding.kind === 'number' ? 'number literal' : 'string array';
  return `${finding.file}:${finding.line}:${finding.column}  unexplained ${what}: ${finding.text}`;
}
