export const ATLAS_VIEWS = [
  "overview",
  "runtime",
  "software",
  "data",
  "network",
  "resources",
  "security",
  "activity",
  "relationships",
  "evidence",
] as const;
export type AtlasView = (typeof ATLAS_VIEWS)[number];
export interface AtlasLocation {
  contextId: string;
  rootId?: string;
  view: AtlasView;
  level: number;
  focusId?: string;
}
const isView = (value: string | null): value is AtlasView =>
  Boolean(value && ATLAS_VIEWS.includes(value as AtlasView));
export function parseAtlasLocation(
  search: string,
  fallbackContext = "local",
): AtlasLocation {
  const params = new URLSearchParams(search),
    level = Number(params.get("atlasLevel"));
  return {
    contextId: params.get("contextId") || fallbackContext,
    rootId: params.get("atlasRoot") || undefined,
    view: isView(params.get("atlasView"))
      ? (params.get("atlasView") as AtlasView)
      : isView(params.get("atlasLens"))
        ? (params.get("atlasLens") as AtlasView)
        : "overview",
    level: Number.isFinite(level) ? Math.max(0, Math.min(4, level)) : 0,
    focusId: params.get("atlasFocus") || undefined,
  };
}
export function serializeAtlasLocation(location: AtlasLocation, current = "") {
  const params = new URLSearchParams(current);
  params.set("contextId", location.contextId);
  params.set("atlasView", location.view);
  params.set("atlasLevel", String(location.level));
  params.delete("atlasLens");
  if (location.rootId) params.set("atlasRoot", location.rootId);
  else params.delete("atlasRoot");
  if (location.focusId) params.set("atlasFocus", location.focusId);
  else params.delete("atlasFocus");
  return `?${params}`;
}
export function createAtlasNavigation(initial: AtlasLocation) {
  let value = { ...initial },
    parents: string[] = [];
  return {
    snapshot: () => ({ ...value }),
    replace(next: Partial<AtlasLocation>) {
      value = { ...value, ...next };
    },
    enter(entityId: string) {
      if (value.rootId) parents.push(value.rootId);
      value = { ...value, rootId: entityId, focusId: undefined, level: 0 };
    },
    up(canonicalParentId?: string) {
      value = {
        ...value,
        rootId: parents.pop() ?? canonicalParentId,
        focusId: undefined,
        level: 0,
      };
    },
    home(contextId = value.contextId) {
      parents = [];
      value = { contextId, view: "overview", level: 0 };
    },
    openView(view: AtlasView) {
      value = { ...value, view, level: 0 };
    },
    focus(focusId?: string) {
      value = { ...value, focusId };
    },
    canUp: () => Boolean(value.rootId),
  };
}
