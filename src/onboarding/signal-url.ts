// The one place Atlas names its default Signal. FNGK_SIGNAL_URL overrides it
// for a whole installation (devstack sets http://signal.localhost), and the
// same variable reaches the fngk child processes, so Atlas and the CLI always
// agree. Choosing another Signal is reserved for self-hosters, through the
// onboarding "Advanced" disclosure.
export const DEFAULT_SIGNAL_URL = "https://signal.nipate.africa";

export function defaultSignalUrl(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeSignalUrl(env.FNGK_SIGNAL_URL?.trim() || DEFAULT_SIGNAL_URL) ?? DEFAULT_SIGNAL_URL;
}

const localHost = (hostname: string) => hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";

/** An https origin, or plain http only for loopback and *.localhost development hosts. */
export function normalizeSignalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol === "https:" || (url.protocol === "http:" && localHost(url.hostname))) return url.origin;
  return null;
}
