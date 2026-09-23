export class BrowserDiagnosticsUnavailableError extends Error {
  readonly code='browser_diagnostics_unavailable';

  constructor(cause:unknown){
    super('Browser diagnostics are unavailable in this Atlas installation. Install the optional browser runtime to use this feature.',{cause});
    this.name='BrowserDiagnosticsUnavailableError';
  }
}

export async function loadBrowserRuntime():Promise<typeof import('playwright')>{
  try{return await import('playwright')}catch(error){throw new BrowserDiagnosticsUnavailableError(error)}
}
