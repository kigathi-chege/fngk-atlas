export function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function framedCommand(command: string, requestId: string): string {
  const frame = requestId.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 80) || 'request';
  return `printf '\\n__ATLAS_BEGIN_${frame}__\\n'; ${command}; __atlas_status=$?; printf '\\n__ATLAS_END_${frame}__:%s\\n' "$__atlas_status"`;
}
