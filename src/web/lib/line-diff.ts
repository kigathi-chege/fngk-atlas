export interface DiffLine { kind: 'same' | 'add' | 'remove' | 'gap'; text: string; oldLine?: number; newLine?: number }

/**
 * Line diff for small previews (LCS). Returns undefined when either side is
 * too large to diff cheaply in the browser.
 */
export function lineDiff(before: string, after: string, options: { maxLines?: number; context?: number } = {}): DiffLine[] | undefined {
  const left = before.split('\n'), right = after.split('\n'), max = options.maxLines ?? 1500, context = options.context ?? 2;
  if (left.length > max || right.length > max) return undefined;
  const width = right.length + 1, table = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i * width + j] = left[i] === right[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { lines.push({ kind: 'same', text: left[i], oldLine: i + 1, newLine: j + 1 }); i++; j++; }
    else if (i < left.length && (j >= right.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) { lines.push({ kind: 'remove', text: left[i], oldLine: i + 1 }); i++; }
    else { lines.push({ kind: 'add', text: right[j], newLine: j + 1 }); j++; }
  }
  const keep = new Set<number>();
  lines.forEach((line, index) => { if (line.kind !== 'same') for (let offset = -context; offset <= context; offset++) keep.add(index + offset); });
  const result: DiffLine[] = [];
  lines.forEach((line, index) => { if (keep.has(index)) result.push(line); else if (result.at(-1)?.kind !== 'gap') result.push({ kind: 'gap', text: '…' }); });
  return result.length && result.every(line => line.kind === 'gap') ? [] : result;
}
