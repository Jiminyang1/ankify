import { z } from "zod";

export const workflowSchema = z.enum([
  "capture", "legacy_review", "coach", "card_generation", "quiz_generation",
  "credit_checkout", "practice_sessions", "session_rating", "session_analysis", "suggestions",
]);

/** Protocol support is separate from a user's credentials, balance, or billing
 * configuration. Clients must still handle authorization/configuration errors. */
export const capabilitiesSchema = z.object({
  protocolVersion: z.literal(1),
  supportedWorkflows: z.array(workflowSchema),
  sessionAnalysis: z.object({
    available: z.boolean(),
    automaticAvailable: z.boolean(),
    requiresOwnKey: z.literal(true),
  }),
  deprecations: z.array(z.object({
    workflow: workflowSchema,
    code: z.enum(["workflow_suspended", "upgrade_required"]),
    message: z.string(),
  })),
});

export type CapabilitiesDto = z.infer<typeof capabilitiesSchema>;
export type WorkflowId = z.infer<typeof workflowSchema>;
