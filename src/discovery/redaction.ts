const secretKey = /(secret|token|credential|password|passwd|cookie|authorization|database_url|private[_-]?key)/i;

export function redactFacts(value: unknown, key = ''): unknown {
  if (secretKey.test(key)) return '[redacted]';
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
