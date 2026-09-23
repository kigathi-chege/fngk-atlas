export interface SoftwareFunctionItem {
  id: string;
  label: string;
  qualifiedName?: string;
  path: string;
  line?: number;
  endLine?: number;
  complexity?: number;
  coverage?: Record<string, unknown> | null;
  crap?: number | null;
  stale: boolean;
}

export function projectSoftwareFunctions(
  index: { nodes?: Array<Record<string, unknown>> } | null | undefined,
  limit = 500,
): { items: SoftwareFunctionItem[] } {
  const bounded = Math.min(10_000, Math.max(1, limit));
  return {
    items: (index?.nodes ?? [])
      .filter((node) => node.type === "function")
      .map((node) => {
        const coverage =
          node.coverage && typeof node.coverage === "object"
            ? (node.coverage as Record<string, unknown>)
            : node.coverage === null
              ? null
              : undefined;
        return {
          id: String(node.id),
          label: String(node.label ?? node.name ?? node.id),
          ...(typeof node.qualifiedName === "string"
            ? { qualifiedName: node.qualifiedName }
            : {}),
          path: String(node.path ?? ""),
          ...(typeof node.line === "number" ? { line: node.line } : {}),
          ...(typeof node.endLine === "number" ? { endLine: node.endLine } : {}),
          ...(typeof node.complexity === "number"
            ? { complexity: node.complexity }
            : {}),
          ...(coverage !== undefined ? { coverage } : {}),
          ...(typeof node.crap === "number" || node.crap === null
            ? { crap: node.crap as number | null }
            : {}),
          stale: Boolean(node.stale) || coverage?.stale === true,
        };
      })
      .sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          (left.line ?? 0) - (right.line ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, bounded),
  };
}
