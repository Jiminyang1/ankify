import type { CapabilitiesDto } from "@ankify/contracts";
import { enabledWorkflows } from "./features";

export function getCapabilities(): CapabilitiesDto {
  // Only implemented, enabled workflows are advertised. Legacy suspension will
  // add deprecations here once the API and worker guards enforce it.
  return {
    protocolVersion: 1,
    supportedWorkflows: enabledWorkflows(),
    sessionAnalysis: { available: false, automaticAvailable: false, requiresOwnKey: true },
    deprecations: [],
  };
}
