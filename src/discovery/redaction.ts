const secretKey = /(secret|token|credential|password|passwd|cookie|authorization|database_url|private[_-]?key|api[_-]?key|access[_-]?key)/i;
const secretValue = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|(["']?(?:token|secret|password|passwd|credential|authorization|api[_-]?key|access[_-]?key)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi;
export const redactSensitiveText=(value:string)=>value.replace(secretValue,(_match,prefix)=>`${prefix??''}[redacted]`);

export const redactCommandLine = (value: string) => value
  .replace(/((?:--?|\/)(?:token|password|passwd|secret|credential|cookie|authorization|api[-_]?key|access[-_]?key)(?:=|\s+))[^\s]+/gi, '$1[redacted]')
  .replace(/((?:TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|COOKIE|AUTHORIZATION|API_KEY|ACCESS_KEY)=)[^\s]+/g, '$1[redacted]')
  .replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[redacted]@');

export function redactFacts(value: unknown, key = ''): unknown {
  if (secretKey.test(key)) return '[redacted]';
  if (key === 'command' && typeof value === 'string') return redactCommandLine(value);
  if (['documentText','description','purpose'].includes(key)&&typeof value==='string')return redactSensitiveText(value);
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
