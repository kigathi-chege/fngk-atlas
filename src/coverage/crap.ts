export const CRAP_FORMULA_VERSION = 'crap.v1';
export function crap(complexity: number, coverageFraction: number): number {
  const value = Math.max(1, complexity), coverage = Math.min(1, Math.max(0, coverageFraction));
  return value ** 2 * (1 - coverage) ** 3 + value;
}
