import { spawn } from "node:child_process";

export type BrowserOpener = (url: string) => Promise<boolean>;

/**
 * Opens a URL in the user's default browser from the Atlas server. The desktop
 * webview's loopback page cannot rely on Tauri IPC, but the server runs as the
 * signed-in desktop user, so the platform opener works. Only http(s) URLs are
 * accepted and the URL is passed as one argument, never through a shell.
 */
export function createSystemBrowserOpener(platform: NodeJS.Platform = process.platform): BrowserOpener {
  return async (url) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const [command, args] = platform === "darwin" ? ["open", [parsed.toString()]] : platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", parsed.toString()]] : ["xdg-open", [parsed.toString()]];
    return await new Promise<boolean>((resolve) => {
      try {
        const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
        child.once("error", () => resolve(false));
        child.once("spawn", () => { child.unref(); resolve(true); });
      } catch { resolve(false); }
    });
  };
}
