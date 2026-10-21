import { describe, expect, it } from 'vitest';
import { applyHunks, compileQuery, computeHunks, expandReplacement, globMatches, grepArguments, pathFilter, toEreSuperset } from '../../src/files/text-query.js';

describe('text queries', () => {
  it('honours case, regex and whole-word flags', () => {
    const find = (query: string, flags: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean }) => [...'foo Foo fooBar foo.bar $foo'.matchAll(compileQuery({ query, ...flags }))].map(match => match.index);
    expect(find('foo', { caseSensitive: true })).toEqual([0, 8, 15, 24]);
    expect(find('foo', {})).toEqual([0, 4, 8, 15, 24]);
    expect(find('foo', { wholeWord: true, caseSensitive: true })).toEqual([0, 15, 24]);
    expect(find('foo.', { caseSensitive: true })).toEqual([15]);
    expect(find('foo.', { regex: true, caseSensitive: true })).toEqual([0, 8, 15]);
    expect(find('$foo', {})).toEqual([23]);
  });

  it('rejects invalid and multi-line patterns with a typed error', () => {
    expect(() => compileQuery({ query: '(', regex: true })).toThrow(expect.objectContaining({ code: 'invalid_pattern' }));
    expect(() => compileQuery({ query: String.raw`a\nb`, regex: true })).toThrow(expect.objectContaining({ code: 'invalid_pattern' }));
    expect(() => compileQuery({ query: '' })).toThrow(expect.objectContaining({ code: 'invalid_pattern' }));
    expect(() => compileQuery({ query: String.raw`a\\nb`, regex: true })).not.toThrow();
  });

  it('widens JS regex syntax into an ERE superset for grep', () => {
    expect(toEreSuperset(String.raw`\bfoo\d+\s*(?:bar|baz)?`)).toBe('foo[0-9]+[[:space:]]*(bar|baz)?');
    expect(toEreSuperset(String.raw`(?<name>x)(?=y)\k<name>\1`)).toBe('(x).*.*');
    expect(toEreSuperset(String.raw`a+?[\]x]b`)).toBe('a+.b');
    expect(toEreSuperset(String.raw`\.\/`)).toBe(String.raw`\./`);
    expect(grepArguments({ query: '-v', caseSensitive: true })).toEqual(['-F', '-e', '-v']);
    expect(grepArguments({ query: 'x', regex: true, wholeWord: true })).toEqual(['-E', '-i', '-w', '-e', 'x']);
  });

  it('matches include and exclude globs the way the panel describes them', () => {
    expect(globMatches('node_modules', 'a/node_modules/b.js')).toBe(true);
    expect(globMatches('*.min.js', 'dist/app.min.js')).toBe(true);
    expect(globMatches('dist/**', 'dist/a/b.js')).toBe(true);
    expect(globMatches('dist/**', 'src/dist.js')).toBe(false);
    const accept = pathFilter(['*.ts', 'docs/*.md'], ['node_modules', '*.d.ts']);
    expect(['src/a.ts', 'src/a.d.ts', 'node_modules/x/a.ts', 'docs/x.md', 'docs/deep/x.md', 'README.md'].filter(value => accept(value))).toEqual(['src/a.ts', 'docs/x.md']);
    expect(accept('node_modules', 'directory')).toBe(false);
    expect(accept('src', 'directory')).toBe(true);
  });
});

describe('replace hunks', () => {
  const text = 'alpha beta\r\nbeta gamma beta\nend';
  it('locates every match with line, column and before/after previews', () => {
    const hunks = computeHunks(text, { query: 'beta', replacement: 'BETA', caseSensitive: true });
    expect(hunks.map(hunk => [hunk.id, hunk.line, hunk.column])).toEqual([[0, 1, 7], [1, 2, 1], [2, 2, 12]]);
    expect(hunks[0]).toMatchObject({ before: 'alpha beta', after: 'alpha BETA', match: 'beta', replacement: 'BETA' });
    expect(hunks[2]).toMatchObject({ before: 'beta gamma beta', after: 'beta gamma BETA' });
  });

  it('applies only the selected hunks and keeps line endings', () => {
    const hunks = computeHunks(text, { query: 'beta', replacement: 'BETA', caseSensitive: true });
    expect(applyHunks(text, hunks, [0, 2])).toEqual({ text: 'alpha BETA\r\nbeta gamma BETA\nend', applied: 2 });
    expect(applyHunks(text, hunks).text).toBe('alpha BETA\r\nBETA gamma BETA\nend');
    expect(applyHunks(text, hunks, []).text).toBe(text);
  });

  it('expands regex replacement templates like String.replace', () => {
    const source = 'let x = 1; let yy = 22;';
    const query = { query: String.raw`let (?<name>\w+) = (\d+)`, regex: true, caseSensitive: true };
    for (const template of ['const $<name> = $2', '$1$2', '$&!', '$$', '[$`]', "[$']", '$3', '$<missing>', '$10']) {
      const hunks = computeHunks(source, { ...query, replacement: template });
      expect(applyHunks(source, hunks).text).toBe(source.replace(new RegExp(query.query, 'g'), template));
    }
    expect(expandReplacement('$1', ['ab', 'a'] as unknown as RegExpMatchArray, 'ab')).toBe('a');
  });

  it('treats a literal replacement literally', () => {
    const hunks = computeHunks('a.b a.b', { query: 'a.b', replacement: '$&$1', caseSensitive: true });
    expect(applyHunks('a.b a.b', hunks).text).toBe('$&$1 $&$1');
  });

  it('handles zero-length regex matches without looping', () => {
    const hunks = computeHunks('one\ntwo', { query: '^', replacement: '> ', regex: true });
    expect(applyHunks('one\ntwo', hunks).text).toBe('> one\n> two');
  });
});
