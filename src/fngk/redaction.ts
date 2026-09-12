export function redact(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/(cookie\s*:\s*)[^\r\n]+/gi, '$1[redacted]')
    .replace(/((?:ticket|credential|token|session|password)\s*[=:]\s*)[^\s&]+/gi, '$1[redacted]');
}
