export type DocumentationTopicId =
  | 'workspace' | 'devices' | 'terminals' | 'files' | 'databases'
  | 'live-projects' | 'deployments' | 'observability' | 'recovery' | 'profiles';

export interface AtlasDocumentationAction {
  readonly label: string;
  readonly event: string;
  readonly detail?: Readonly<Record<string, string | boolean | number>>;
}

export interface AtlasDocumentationTopic {
  readonly id: DocumentationTopicId;
  readonly title: string;
  readonly category: string;
  readonly summary: string;
  readonly relatedPanels: readonly string[];
  readonly actions: readonly AtlasDocumentationAction[];
  readonly load: () => Promise<string>;
}

const raw = (loader: () => Promise<{ default: string }>) => async () => (await loader()).default;

export const atlasDocumentation: readonly AtlasDocumentationTopic[] = Object.freeze([
  {id:'workspace',title:'Workspace and panels',category:'Getting started',summary:'Arrange tools without losing their state.',relatedPanels:['atlas.workspace','atlas.navigator','atlas.filesystem'],actions:[{label:'Open Filesystem',event:'atlas:focus-files'}],load:raw(()=>import('../docs/workspace.md?raw'))},
  {id:'devices',title:'Devices and contexts',category:'Getting started',summary:'Choose, color, disconnect, and safely manage the FNGK Device Atlas is operating on.',relatedPanels:['atlas.observatory','atlas.navigator','atlas.device-lifecycle'],actions:[{label:'Open Device Atlas',event:'atlas:open-device-atlas'},{label:'Open Device lifecycle',event:'atlas:open-device-lifecycle'}],load:raw(()=>import('../docs/devices.md?raw'))},
  {id:'terminals',title:'Terminals and sessions',category:'Operate',summary:'Open, reconnect, minimize, archive, and recover retained terminal sessions.',relatedPanels:['atlas.terminal'],actions:[{label:'Open Terminal',event:'atlas:open-terminal'}],load:raw(()=>import('../docs/terminals.md?raw'))},
  {id:'files',title:'Files and editors',category:'Operate',summary:'Browse, open, edit, save, and pin files on the selected Device.',relatedPanels:['atlas.filesystem'],actions:[{label:'Open Filesystem',event:'atlas:open-root',detail:{path:'/'} }],load:raw(()=>import('../docs/files.md?raw'))},
  {id:'databases',title:'Databases',category:'Operate',summary:'Inspect an adopted database through its capability-scoped Device surface.',relatedPanels:['database'],actions:[],load:raw(()=>import('../docs/databases.md?raw'))},
  {id:'live-projects',title:'Live Projects',category:'Build',summary:'Run a project in a dedicated terminal and publish its selected port.',relatedPanels:['live-project'],actions:[],load:raw(()=>import('../docs/live-projects.md?raw'))},
  {id:'deployments',title:'Deployments',category:'Build',summary:'Build immutable releases, review health, publish, and roll back safely.',relatedPanels:['deployment'],actions:[],load:raw(()=>import('../docs/deployments.md?raw'))},
  {id:'observability',title:'Observability and logs',category:'Understand',summary:'Use Device Atlas, logs, metrics, and activity to understand current state.',relatedPanels:['atlas.observatory','logs','metrics','output'],actions:[{label:'Open Device Atlas',event:'atlas:open-device-atlas'}],load:raw(()=>import('../docs/observability.md?raw'))},
  {id:'recovery',title:'Recovery and readiness',category:'Recover',summary:'Understand FNGK readiness, repair required setup, and return to a safe state.',relatedPanels:['atlas.device-lifecycle','atlas.fngk-handoff'],actions:[{label:'Open Device lifecycle',event:'atlas:open-device-lifecycle'}],load:raw(()=>import('../docs/recovery.md?raw'))},
  {id:'profiles',title:'Profiles and connection scope',category:'Getting started',summary:'Use the matching FNGK profile without interrupting remote sessions.',relatedPanels:['atlas.device-lifecycle'],actions:[{label:'Open Device lifecycle',event:'atlas:open-device-lifecycle'}],load:raw(()=>import('../docs/profiles.md?raw'))},
]);

export const documentationTopicIds = Object.freeze(atlasDocumentation.map(topic => topic.id));
const byId = new Map(atlasDocumentation.map(topic => [topic.id, topic]));
export function findDocumentationTopic(id: string | undefined): AtlasDocumentationTopic | undefined { return id ? byId.get(id as DocumentationTopicId) : undefined; }
export function findDocumentationAction(topicId: string | undefined,event: string | undefined): AtlasDocumentationAction | undefined { return findDocumentationTopic(topicId)?.actions.find(action=>action.event===event); }
export async function loadDocumentationTopic(id: string | undefined): Promise<string | undefined> { return await findDocumentationTopic(id)?.load(); }
