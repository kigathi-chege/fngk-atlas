export type DeviceReadinessState =
  | 'inspection-unavailable'
  | 'ready'
  | 'needs-profile'
  | 'needs-login'
  | 'needs-pairing'
  | 'needs-daemon'
  | 'needs-update'
  | 'legacy-recovery'
  | 'offline';

export type SafeLifecycleProfile = {
  name: string;
  current: boolean;
  mode: string;
  paired: boolean;
  operatorAuthorized: boolean;
  daemon: 'running' | 'stopped' | 'unknown';
};

export type DeviceReadiness = {
  protocolVersion: 'atlas.device-lifecycle.v1';
  contextId: string;
  state: DeviceReadinessState;
  profileSelection: 'automatic' | 'required' | 'explicit' | 'unavailable';
  profiles: SafeLifecycleProfile[];
  profile?: SafeLifecycleProfile;
  diagnostics: Array<{ code: string; message: string }>;
  capabilities: DeviceLifecycleCapabilities;
};

export type DeviceLifecycleCapabilities = Record<'disconnect'|'retire'|'delete', {available:boolean;reason?:string}>;

export type RemoteLifecycleInspection = { state: string; terminal?: string; daemon?: string; activeAgentVersion?: string; paired?: boolean };

type LifecycleSource = {
  profiles: () => Promise<{ profiles: SafeLifecycleProfile[] }>;
  contexts: (profile?: string) => Promise<{ contexts: Array<{ id: string; kind?: string; online?: boolean }> }>;
  /** fngk devices ID lifecycle --json: what the Device's own agent reports. */
  remote?: (deviceId: string, profile: string) => Promise<RemoteLifecycleInspection>;
};

const usable = (profile: SafeLifecycleProfile) => profile.operatorAuthorized;

export class DeviceLifecycleService {
  constructor(private readonly source: LifecycleSource) {}

  async inspect(contextId: string, requestedProfile?: string): Promise<DeviceReadiness> {
    const [{ contexts }, { profiles }] = await Promise.all([this.source.contexts(requestedProfile), this.source.profiles()]);
    const context = contexts.find((candidate) => candidate.id === contextId);
    if (!context || context.kind !== 'fngk-device') {
      return this.result(contextId, 'offline', 'unavailable', profiles, undefined, 'device_context_unavailable', 'Choose an online FNGK Device before managing its lifecycle.');
    }
    if (context.online === false) {
      return this.result(contextId, 'offline', 'unavailable', profiles, undefined, 'device_offline', 'This Device is offline. Reconnect it before continuing.');
    }

    const selected = requestedProfile ? profiles.find((profile) => profile.name === requestedProfile) : undefined;
    if (requestedProfile && !selected) {
      return this.result(contextId, 'needs-profile', 'required', profiles, undefined, 'profile_not_found', 'The selected FNGK profile is not available.');
    }
    const candidates = profiles.filter(usable);
    const profile = selected ?? (profiles.length === 1 ? profiles[0] : candidates.length === 1 ? candidates[0] : undefined);
    const selection = selected ? 'explicit' : profile ? 'automatic' : candidates.length > 1 ? 'required' : 'unavailable';
    if (!profile) {
      return this.result(contextId, 'needs-profile', selection, profiles, undefined, candidates.length ? 'profile_selection_required' : 'profile_unavailable', candidates.length ? 'Select a FNGK profile for this Device.' : 'No usable FNGK profile is available.');
    }

    if (!profile.operatorAuthorized) return this.result(contextId, 'needs-login', selection, profiles, profile, 'operator_authorization_required', 'Authorize the selected FNGK profile before managing this Device.');

    if (this.source.remote) {
      try {
        const remote = await this.source.remote(contextId.slice('device:'.length), profile.name);
        if (remote.state === 'offline') return this.result(contextId, 'offline', selection, profiles, profile, 'device_offline', 'This Device is offline. Reconnect it before continuing.');
        if (remote.state === 'ready' && remote.terminal === 'available') return this.result(contextId, 'ready', selection, profiles, profile, 'remote_ready', `The Device agent${remote.activeAgentVersion ? ` ${remote.activeAgentVersion}` : ''} is ready (daemon ${remote.daemon ?? 'unknown'}).`);
        return this.result(contextId, 'inspection-unavailable', selection, profiles, profile, 'remote_not_ready', `The Device agent reported ${remote.state} with terminal ${remote.terminal ?? 'unknown'}.`);
      } catch (error) {
        if ((error as { code?: string }).code === 'lifecycle_inspection_unsupported') return this.result(contextId, 'needs-update', selection, profiles, profile, 'lifecycle_inspection_unsupported', (error as Error).message);
        return this.result(contextId, 'inspection-unavailable', selection, profiles, profile, 'remote_inspection_failed', `The Device did not answer a lifecycle inspection: ${(error as Error).message}`);
      }
    }
    return this.result(contextId, 'inspection-unavailable', selection, profiles, profile, 'remote_inspection_unavailable', 'This Device is online. Local profile authorization is available, but this Atlas bridge cannot yet verify the remote daemon or update readiness. Local pairing and daemon state describe this computer, not the selected Device.');
  }

  private result(contextId: string, state: DeviceReadinessState, profileSelection: DeviceReadiness['profileSelection'], profiles: SafeLifecycleProfile[], profile: SafeLifecycleProfile | undefined, code: string, message: string): DeviceReadiness {
    const disconnect=(state==='inspection-unavailable'||state==='ready'||state==='needs-update')&&Boolean(profile)?{available:true}:{available:false,reason:'Connect an online Device with an authorized profile before releasing its local Atlas route.'};
    const unavailable={available:false,reason:'This FNGK control-plane operation is not available to Atlas yet. Atlas will not emulate it with a shell command.'};
    return { protocolVersion: 'atlas.device-lifecycle.v1', contextId, state, profileSelection, profiles: profiles.map((value) => ({ ...value })), ...(profile ? { profile: { ...profile } } : {}), diagnostics: [{ code, message }], capabilities:{disconnect,retire:unavailable,delete:unavailable} };
  }
}
