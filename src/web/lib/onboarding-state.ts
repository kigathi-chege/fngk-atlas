export type OnboardingPresentation = {
  kind: "ready" | "setup" | "atlas-unavailable";
  title: string;
  message: string;
  action?: string;
};

export function resolveOnboardingPresentation(status: { state?: string; local?: { message?: string } } | undefined, error = ""): OnboardingPresentation {
  if (!status) {
    return {
      kind: "atlas-unavailable",
      title: "Atlas service unavailable",
      message: "Atlas could not check FNGK because its local service is unavailable.",
      action: "Retry Atlas connection",
    };
  }
  if (status.state === "ready") return { kind: "ready", title: "FNGK ready", message: status.local?.message ?? "FNGK is ready." };
  return { kind: "setup", title: "Connect Atlas to this machine", message: status.local?.message ?? (error || "FNGK needs attention.") };
}
