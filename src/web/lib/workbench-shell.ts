/** Versioned, framework-free rules for Atlas's retained workspace shell. */
export const shellLayoutVersion=8;
export const permanentPanelIds=['atlas.workspace','atlas.devices','atlas.device-details','atlas.filesystem','atlas.inspector','atlas.operations'] as const;
const permanent=new Set<string>(permanentPanelIds);
export function isPermanentPanel(id:string){return permanent.has(id)}
/** Operations is a retained dock, not an ordinary center document. */
export function isWorkspaceFallbackVisible(panelIds:readonly string[]){return !panelIds.some(id=>!isPermanentPanel(id))}
