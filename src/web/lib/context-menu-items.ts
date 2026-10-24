import FolderOpen from '@lucide/svelte/icons/folder-open';import Bot from '@lucide/svelte/icons/bot';import Waypoints from '@lucide/svelte/icons/waypoints';import Database from '@lucide/svelte/icons/database';import SquareTerminal from '@lucide/svelte/icons/square-terminal';import ScanSearch from '@lucide/svelte/icons/scan-search';import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';import Share2 from '@lucide/svelte/icons/share-2';import Download from '@lucide/svelte/icons/download';import Play from '@lucide/svelte/icons/play';import Rocket from '@lucide/svelte/icons/rocket';
import type {Component} from 'svelte';
import type {MenuEntry} from './menu.js';
import type {ContextAction} from './context-actions.js';

const icons:Record<string,Component<any>>={files:FolderOpen,intelligence:Bot,architecture:Waypoints,database:Database,terminal:SquareTerminal,'code-map':ScanSearch,metrics:ChartNoAxesCombined,ports:Share2,handoff:Download,live:Play,deploy:Rocket};

// Workspace actions as menu entries, a divider between each group. Ids keep the action id.
export function contextActionEntries(actions:ContextAction[]):MenuEntry[]{
  return (['workflow','observe','navigate','intelligence'] as const).flatMap(group=>['separator' as const,...actions.filter(action=>action.group===group).map(action=>({id:action.id,label:action.label,icon:icons[action.id]}))]);
}
