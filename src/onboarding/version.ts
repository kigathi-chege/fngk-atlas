/** Semantic-version comparison (`v` prefix optional; a pre-release sorts before its release). Undefined when either side is not a version. */
export function compareVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const a = parse(left), b = parse(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  if (a.pre === b.pre) return 0;
  if (a.pre === undefined) return 1;
  if (b.pre === undefined) return -1;
  const left_ = a.pre.split("."), right_ = b.pre.split(".");
  for (let index = 0; index < Math.max(left_.length, right_.length); index++) {
    const x = left_[index], y = right_[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function parse(value: string): { core: [number, number, number]; pre?: string } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] } : undefined;
}

/** `fngk version` prints `fngk v1.2.3` (or the legacy `signal v1.2.3`). */
export function parseVersionOutput(output: string): string | undefined {
  const token = output.trim().split(/\s+/).pop();
  return token && /^v?\d/.test(token) ? token : undefined;
}
