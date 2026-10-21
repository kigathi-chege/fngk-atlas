// Pure text query, glob and replace helpers shared by the server, the
// transports and the web UI. No Node or DOM dependencies.

export interface TextQuery { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }
export interface ReplaceQuery extends TextQuery { replacement: string }
export interface Hunk {
  /** Index of the match in the file, stable for identical content and query. */
  id: number;
  start: number; end: number;
  line: number; column: number; endLine: number; endColumn: number;
  match: string; replacement: string;
  /** The (possibly clipped) line before and after applying only this hunk. */
  before: string; after: string;
}

const WORD = 'A-Za-z0-9_';

export function invalidPattern(message: string): Error { return Object.assign(new Error(message), { code: 'invalid_pattern' }); }
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiles the user query to a global, multiline JS RegExp. */
export function compileQuery(query: TextQuery): RegExp {
  if (!query.query) throw invalidPattern('The search query is empty.');
  if (/\n/.test(query.query) || (query.regex && /(^|[^\\])(\\\\)*\\n/.test(query.query))) throw invalidPattern('Patterns that span lines are not supported.');
  let source = query.regex ? query.query : escapeRegExp(query.query);
  if (query.wholeWord) source = `(?<![${WORD}])(?:${source})(?![${WORD}])`;
  try { return new RegExp(source, `gm${query.caseSensitive ? '' : 'i'}`); }
  catch (error) { throw invalidPattern(`Invalid regular expression: ${(error as Error).message}`); }
}

/**
 * Translates a JS pattern into a POSIX ERE that matches a superset of the
 * lines the JS pattern matches. grep only preselects candidates; the JS
 * RegExp makes the final decision, so constructs ERE lacks are widened.
 */
export function toEreSuperset(pattern: string): string {
  let out = '', index = 0;
  const skipGroup = (from: number) => { let depth = 0; for (let cursor = from; cursor < pattern.length; cursor++) { const char = pattern[cursor]; if (char === '\\') { cursor++; continue; } if (char === '[') { cursor++; while (cursor < pattern.length && pattern[cursor] !== ']') { if (pattern[cursor] === '\\') cursor++; cursor++; } continue; } if (char === '(') depth++; else if (char === ')' && --depth === 0) return cursor + 1; } return pattern.length; };
  const literal = (char: string) => /[.[\]()*+?{}|^$\\]/.test(char) ? `\\${char}` : char;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '\\') {
      const next = pattern[index + 1] ?? ''; index += 2;
      if (next === 'd') out += '[0-9]'; else if (next === 'D') out += '[^0-9]';
      else if (next === 'w') out += `[${WORD}]`; else if (next === 'W') out += `[^${WORD}]`;
      else if (next === 's') out += '[[:space:]]'; else if (next === 'S') out += '[^[:space:]]';
      else if (next === 'b' || next === 'B') { /* assertion: widen */ }
      else if (next === 't') out += '\t';
      else if (/[1-9]/.test(next)) { while (/[0-9]/.test(pattern[index] ?? '')) index++; out += '.*'; }
      else if (next === 'k' && pattern[index] === '<') { index = pattern.indexOf('>', index) + 1 || pattern.length; out += '.*'; }
      else if (next === 'x' && /^[0-9a-fA-F]{2}/.test(pattern.slice(index))) { out += literal(String.fromCharCode(Number.parseInt(pattern.slice(index, index + 2), 16))); index += 2; }
      else if (next === 'u' && /^[0-9a-fA-F]{4}/.test(pattern.slice(index))) { out += literal(String.fromCharCode(Number.parseInt(pattern.slice(index, index + 4), 16))); index += 4; }
      else if ((next === 'p' || next === 'P') && pattern[index] === '{') { index = pattern.indexOf('}', index) + 1 || pattern.length; out += '.'; }
      else if (/[A-Za-z0]/.test(next)) out += '.';
      else out += literal(next);
      continue;
    }
    if (char === '[') {
      let cursor = index + 1, body = '';
      if (pattern[cursor] === '^') { body += '^'; cursor++; }
      if (pattern[cursor] === ']') { body += ']'; cursor++; }
      let escaped = false;
      while (cursor < pattern.length && pattern[cursor] !== ']') { if (pattern[cursor] === '\\') { escaped = true; body += pattern[cursor + 1] ?? ''; cursor += 2; continue; } body += pattern[cursor++]; }
      index = cursor + 1;
      // ERE has no escapes inside brackets; widen rather than mistranslate.
      out += escaped ? '.' : `[${body}]`;
      continue;
    }
    if (char === '(' && pattern[index + 1] === '?') {
      const kind = pattern.slice(index + 2, index + 4);
      if (kind.startsWith('=') || kind.startsWith('!') || kind === '<=' || kind === '<!') { index = skipGroup(index); continue; }
      if (kind.startsWith(':')) { out += '('; index += 3; continue; }
      if (kind.startsWith('<')) { const close = pattern.indexOf('>', index); out += '('; index = close < 0 ? pattern.length : close + 1; continue; }
    }
    if (char === '?' && /[*+?}]/.test(pattern[index - 1] ?? '') && pattern[index - 2] !== '\\') { index++; continue; }
    out += char; index++;
  }
  return out;
}

/** grep arguments selecting candidate lines; always pair with a JS check. */
export function grepArguments(query: TextQuery): string[] {
  const args = [query.regex ? '-E' : '-F'];
  if (!query.caseSensitive) args.push('-i');
  if (query.wholeWord) args.push('-w');
  args.push('-e', query.regex ? toEreSuperset(query.query) : query.query);
  return args;
}

/** Glob to RegExp: `*` stays within a segment, `**` crosses segments. */
export function globToRegExp(glob: string): RegExp {
  let source = '', index = 0;
  const value = glob.replace(/^\.\//, '');
  while (index < value.length) {
    const char = value[index];
    if (char === '*') { if (value[index + 1] === '*') { index += 2; if (value[index] === '/') { index++; source += '(?:.*/)?'; } else source += '.*'; continue; } source += '[^/]*'; index++; continue; }
    if (char === '?') { source += '[^/]'; index++; continue; }
    if (char === '[') { const close = value.indexOf(']', index + 1); if (close > index) { source += `[${value.slice(index + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; index = close + 1; continue; } }
    if (char === '{') { const close = value.indexOf('}', index); if (close > index) { source += `(?:${value.slice(index + 1, close).split(',').map(escapeRegExp).join('|')})`; index = close + 1; continue; } }
    source += escapeRegExp(char); index++;
  }
  return new RegExp(`^${source}$`);
}

export function parseGlobs(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return values.map(item => String(item).trim()).filter(Boolean).slice(0, 32);
}

/** Matches a glob against a root-relative path: basename globs match any segment's file name. */
export function globMatches(glob: string, relativePath: string): boolean {
  const pattern = glob.replace(/\/+$/, '');
  const expression = globToRegExp(pattern.replace(/^\*\*\//, ''));
  if (!pattern.includes('/') || pattern.startsWith('**/')) return relativePath.split('/').some(segment => expression.test(segment)) || expression.test(relativePath);
  return expression.test(relativePath) || relativePath.split('/').some((_, index, parts) => expression.test(parts.slice(0, index + 1).join('/')));
}

export function pathFilter(include: string[], exclude: string[]) {
  return (relativePath: string, type: 'file' | 'directory' = 'file') => {
    if (exclude.some(glob => globMatches(glob, relativePath))) return false;
    if (type === 'directory' || !include.length) return true;
    const name = relativePath.split('/').at(-1) ?? relativePath;
    return include.some(glob => glob.includes('/') && !glob.startsWith('**/') ? globToRegExp(glob).test(relativePath) : globToRegExp(glob.replace(/^\*\*\//, '')).test(name));
  };
}

/** Finds each match in a single line, returning 1-based columns. */
export function lineMatches(line: string, expression: RegExp, limit = 50): Array<{ column: number; length: number }> {
  const values: Array<{ column: number; length: number }> = [];
  expression.lastIndex = 0;
  for (const match of line.matchAll(expression)) { values.push({ column: (match.index ?? 0) + 1, length: match[0].length }); if (values.length >= limit) break; }
  return values;
}

/** Expands `$&`, `$1`, `$<name>`, `` $` ``, `$'` and `$$` the way String.replace does. */
export function expandReplacement(template: string, match: RegExpMatchArray, input: string): string {
  const groups = match.slice(1), named = match.groups ?? {}, offset = match.index ?? 0;
  return template.replace(/\$(\$|&|`|'|<([^>]*)>|(\d{1,2}))/g, (whole, token: string, name?: string, digits?: string) => {
    if (token === '$') return '$';
    if (token === '&') return match[0];
    if (token === '`') return input.slice(0, offset);
    if (token === "'") return input.slice(offset + match[0].length);
    if (name !== undefined) return match.groups ? (named[name] ?? '') : whole;
    if (digits !== undefined) {
      const two = Number(digits);
      if (digits.length === 2 && two >= 1 && two <= groups.length) return groups[two - 1] ?? '';
      const one = Number(digits[0]);
      if (one >= 1 && one <= groups.length) return (groups[one - 1] ?? '') + digits.slice(1);
    }
    return whole;
  });
}

function lineStarts(text: string): number[] { const starts = [0]; for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1); return starts; }
function locate(starts: number[], offset: number) { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) low = mid; else high = mid - 1; } return { line: low + 1, column: offset - starts[low] + 1 }; }
const clip = (value: string, max = 400) => value.length > max ? `${value.slice(0, max)}…` : value;

export function computeHunks(text: string, query: ReplaceQuery, options: { limit?: number } = {}): Hunk[] {
  const expression = compileQuery(query), starts = lineStarts(text), hunks: Hunk[] = [], limit = options.limit ?? 5_000;
  for (const match of text.matchAll(expression)) {
    const start = match.index ?? 0, end = start + match[0].length;
    const replacement = query.regex ? expandReplacement(query.replacement, match, text) : query.replacement;
    const from = locate(starts, start), to = locate(starts, end);
    const lineStart = starts[from.line - 1], lineEndIndex = text.indexOf('\n', end), lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
    const before = text.slice(lineStart, lineEnd).replace(/\r$/, ''), after = (text.slice(lineStart, start) + replacement + text.slice(end, lineEnd)).replace(/\r$/, '');
    hunks.push({ id: hunks.length, start, end, line: from.line, column: from.column, endLine: to.line, endColumn: to.column, match: match[0], replacement, before: clip(before), after: clip(after) });
    if (hunks.length >= limit) break;
  }
  return hunks;
}

/** Applies the selected hunks (by id) from right to left so offsets stay valid. */
export function applyHunks(text: string, hunks: Hunk[], selected?: Iterable<number>): { text: string; applied: number } {
  const wanted = selected ? new Set(selected) : undefined, chosen = hunks.filter(hunk => !wanted || wanted.has(hunk.id)).sort((left, right) => right.start - left.start);
  let result = text;
  for (const hunk of chosen) result = result.slice(0, hunk.start) + hunk.replacement + result.slice(hunk.end);
  return { text: result, applied: chosen.length };
}
