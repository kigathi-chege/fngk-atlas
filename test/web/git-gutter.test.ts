import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { lineChanges } from '../../src/web/lib/git/git-gutter.js';

const text = (value: string) => Text.of(value.split('\n'));

describe('editor gutter changes versus HEAD', () => {
  it('marks added, modified and deleted lines on the current document', () => {
    const head = text('one\ntwo\nthree\nfour\nfive\n');
    expect(lineChanges(head, head)).toEqual([]);
    expect(lineChanges(head, text('one\ntwo\nnew\nthree\nfour\nfive\n'))).toEqual([{ line: 3, change: 'added' }]);
    expect(lineChanges(head, text('one\nTWO\nthree\nfour\nfive\n'))).toEqual([{ line: 2, change: 'modified' }]);
    expect(lineChanges(head, text('one\nthree\nfour\nfive\n'))).toEqual([{ line: 2, change: 'deleted' }]);
  });

  it('treats a file absent from HEAD as entirely added', () => {
    expect(lineChanges(Text.empty, text('a\nb'))).toEqual([{ line: 1, change: 'added' }, { line: 2, change: 'added' }]);
  });
});
