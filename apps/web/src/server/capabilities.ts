import type { CapabilitiesDto } from "@ankify/contracts";
import { enabledWorkflows, isAutomaticAnalysisEnabled, LEGACY_WORKFLOWS } from "./features";

export function getCapabilities(): CapabilitiesDto {
  // Only implemented, enabled workflows are advertised. A retired legacy
  // workflow is listed as deprecated only once its routes enforce it.
  const enabled = enabledWorkflows();
  return {
    protocolVersion: 1,
    supportedWorkflows: enabled,
    sessionAnalysis: {
      available: enabled.includes("session_analysis"),
      automaticAvailable: isAutomaticAnalysisEnabled(),
      requiresOwnKey: true,
    },
    deprecations: Object.entries(LEGACY_WORKFLOWS)
      .filter(([workflow]) => !enabled.includes(workflow as (typeof enabled)[number]))
      .map(([workflow, retired]) => ({ workflow: workflow as (typeof enabled)[number], code: retired!.code, message: retired!.message })),
  };
}
