const secretKey = /(secret|token|credential|password|passwd|cookie|authorization|database_url|private[_-]?key)/i;

export const redactCommandLine = (value: string) => value
  .replace(/((?:--?|\/)(?:token|password|passwd|secret|credential|cookie|authorization)(?:=|\s+))[^\s]+/gi, '$1[redacted]')
  .replace(/((?:TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|COOKIE|AUTHORIZATION)=)[^\s]+/g, '$1[redacted]')
  .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[redacted]@');

export function redactFacts(value: unknown, key = ''): unknown {
  if (secretKey.test(key)) return '[redacted]';
  if (key === 'command' && typeof value === 'string') return redactCommandLine(value);
  if (Array.isArray(value)) return value.map(item => redactFacts(item));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (/^(content|body|bodyBase64|raw)$/i.test(childKey)) continue;
      output[childKey] = redactFacts(child, childKey);
    }
    return output;
  }
  return value;
}
