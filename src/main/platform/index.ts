import type { ContextProvider, SelectionProvider, Target } from '../../shared/types';
export class ManualPlatform implements ContextProvider, SelectionProvider {
  constructor(readonly name: 'windows' | 'macos' | 'linux-x11' | 'linux-wayland') {}
  async capture(_includeSelection = false): Promise<Target> { return { platform: this.name, identity: null, field: null, secure: null, terminal: false }; }
  async read(_target: Target): Promise<string | null> { return null; }
  async validate(_target: Target): Promise<boolean> { return false; }
  capabilities(): Record<string,string> { return { platform: this.name, microphone: 'AudioWorklet; permission and device required', toggle: 'Registration checked at startup', pushToTalk: 'Unavailable: no validated key-up adapter', target: 'Unavailable: manual delivery required', selection: 'Unavailable: external editing disabled', insertion: 'Explicit copy only; in-app test field supported', privacy: 'No application network API; native process audit required' }; }
}
export function platformAdapter(): ManualPlatform {
  return new ManualPlatform(process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.env['XDG_SESSION_TYPE'] === 'wayland' ? 'linux-wayland' : 'linux-x11');
}
