/** Versioned, framework-free rules for Atlas's retained workspace shell. */
export const shellLayoutVersion=8;
export const permanentPanelIds=['atlas.workspace','atlas.devices','atlas.device-details','atlas.filesystem','atlas.inspector','atlas.operations'] as const;
const permanent=new Set<string>(permanentPanelIds);
const bottomDockPanels=new Set(['atlas.observability','atlas.activity','atlas.metrics','atlas.terminal']);
export function isPermanentPanel(id:string){return permanent.has(id)}
/** A bottom-dock tool does not replace the central Workspace fallback. */
export function isBottomDockPanel(id:string){return bottomDockPanels.has(id)||id.startsWith('atlas.terminal:')}
/** Operations is a retained dock, not an ordinary center document. */
export function isWorkspaceFallbackVisible(panelIds:readonly string[]){return !panelIds.some(id=>!isPermanentPanel(id)&&!isBottomDockPanel(id))}
