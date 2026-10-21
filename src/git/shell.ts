import { posixQuote } from '../transports/posix.js';

/**
 * Git runs on the machine that holds the files, through the same POSIX shell
 * routes Atlas uses for files: a local `/bin/sh -lc` or a Device Session PTY
 * that may be dash or busybox sh. Every invocation therefore:
 *
 *  - runs in a subshell, so `cd`, variables and `exit` never touch the shared
 *    shell's state;
 *  - captures stdout and stderr into private temp files and reports the git
 *    status with `s=$?` (a pipeline would report the last command instead);
 *  - base64-encodes both streams, because the PTY mangles NUL bytes and CRs.
 *
 * The framed reply is `<stdout base64>:<stderr base64>` and the subshell exits
 * with git's own status, which the executor's frame reports authoritatively.
 */

/** Marks where the captured streams start; a login shell may print first. */
const SENTINEL = '@ATLAS-GIT@';

/** Statuses the wrapper raises itself. git uses 0, 1, 128 and 129. */
export const GIT_STATUS = { missingRoot: 66, tempUnavailable: 70, tooLarge: 65 } as const;

const ENV = 'GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 LC_ALL=C GIT_PAGER=cat';
const CONFIG = '-c color.ui=false -c core.quotepath=false';
/** Applied only when the operator has not configured their own SSH command. */
const SSH_DEFAULT = `[ -n "\${GIT_SSH_COMMAND+x}" ] || { GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=8'; export GIT_SSH_COMMAND; }`;

/** `git` with Atlas' non-interactive environment and quoted arguments. */
export function git(args: readonly string[]): string {
  for (const arg of args) if (arg.includes('\0')) throw Object.assign(new Error('Git arguments cannot contain NUL bytes.'), { code: 'invalid_argument' });
  return `${ENV} git --no-pager ${CONFIG} ${args.map(posixQuote).join(' ')}`;
}

export interface CaptureOptions {
  /** Bytes for the body's standard input, delivered through a private temp file. */
  stdin?: Buffer;
}

/**
 * Run `body` (a POSIX command list, typically built with `git()`) inside
 * `root`, capturing both streams. The stdin bytes, when present, are decoded
 * into `$i` and the body's stdin comes from it; otherwise stdin is /dev/null so
 * nothing can wait on the PTY.
 */
export function captured(root: string, body: string, options: CaptureOptions = {}): string {
  const input = options.stdin ? `printf '%s' ${posixQuote(options.stdin.toString('base64'))} | base64 -d > "$i" || exit ${GIT_STATUS.tempUnavailable}; ` : '';
  return [
    '(',
    `cd -- ${posixQuote(root)} 2>/dev/null || exit ${GIT_STATUS.missingRoot};`,
    `${SSH_DEFAULT};`,
    `t=$(mktemp 2>/dev/null) || exit ${GIT_STATUS.tempUnavailable}; e="$t.e"; i="$t.i"; : > "$i";`,
    `${input}{ ${body}; } < "$i" > "$t" 2> "$e"; s=$?;`,
    `printf '%s' '${SENTINEL}'; base64 < "$t" | tr -d '\\n'; printf ':'; base64 < "$e" | tr -d '\\n';`,
    'rm -f -- "$t" "$e" "$i"; exit "$s"',
    ')',
  ].join(' ');
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decode the `<stdout>:<stderr>` reply; anything else is a broken transport. */
export function decodeCaptured(output: Buffer): { stdout: Buffer; stderr: string } {
  const all = output.toString('utf8'), at = all.lastIndexOf(SENTINEL);
  if (at < 0) throw Object.assign(new Error('The machine returned malformed git output.'), { code: 'git_protocol_invalid' });
  const text = all.slice(at + SENTINEL.length).replace(/\s+/g, ''), colon = text.indexOf(':');
  const out = colon < 0 ? text : text.slice(0, colon), err = colon < 0 ? '' : text.slice(colon + 1);
  if (colon < 0 || !BASE64.test(out) || !BASE64.test(err)) throw Object.assign(new Error('The machine returned malformed git output.'), { code: 'git_protocol_invalid' });
  return { stdout: Buffer.from(out, 'base64'), stderr: Buffer.from(err, 'base64').toString('utf8') };
}

/**
 * A command for a long operation (fetch, pull, push, clone). Its output is
 * streamed as plain text rather than captured, so progress reaches the panel
 * as it happens. Carriage returns are turned into newlines on the machine so
 * the PTY's own CR handling cannot mangle progress lines.
 */
export function streamed(root: string, body: string): string {
  return [
    '(',
    `cd -- ${posixQuote(root)} 2>/dev/null || { echo 'The repository folder does not exist on this machine.'; exit ${GIT_STATUS.missingRoot}; };`,
    `${SSH_DEFAULT};`,
    `t=$(mktemp 2>/dev/null) || exit ${GIT_STATUS.tempUnavailable};`,
    `{ ${body}; } < /dev/null > "$t" 2>&1 & p=$!;`,
    // Follow the log while git runs. `tail -f --pid` is GNU-only, so poll.
    `o=0; while :; do if kill -0 "$p" 2>/dev/null; then r=1; else r=0; fi; n=$(wc -c < "$t"); if [ "$n" -gt "$o" ]; then tail -c "+$((o + 1))" "$t" | head -c "$((n - o))" | tr '\\r' '\\n'; o=$n; fi; [ "$r" = 1 ] || break; sleep 0.25 2>/dev/null || sleep 1; done;`,
    'wait "$p"; s=$?; rm -f -- "$t"; exit "$s"',
    ')',
  ].join(' ');
}
