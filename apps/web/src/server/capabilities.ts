import type { CapabilitiesDto } from "@ankify/contracts";

export function getCapabilities(): CapabilitiesDto {
  // Preparation only: no new workflow is advertised before its API and worker
  // invariants exist. Legacy suspension will share the guards at cutover.
  return {
    protocolVersion: 1,
    supportedWorkflows: ["capture", "legacy_review", "coach", "card_generation", "quiz_generation", "credit_checkout"],
    sessionAnalysis: { available: false, automaticAvailable: false, requiresOwnKey: true },
    deprecations: [],
  };
}
