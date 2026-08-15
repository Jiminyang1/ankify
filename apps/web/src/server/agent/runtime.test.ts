import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import type { AgentSession } from "@ankify/db";
import { classifyAgentError } from "./errors";
import {
  buildAgentUserContent,
  buildCompressedSessionMessages,
  buildSessionSummaryPrompt,
  prepareAgentResponseMessages,
  STUDY_COACH_INSTRUCTIONS,
} from "./prompt";
import { toAgentSessionDto } from "./store";

describe("classifyAgentError", () => {
  it("classifies a cancelled Agent request as an interruption", () => {
    expect(classifyAgentError(new DOMException("aborted", "AbortError"))).toEqual({
      code: "agent_interrupted",
      message: "The Study Coach response was interrupted.",
    });
  });
});

describe("Study Coach model context", () => {
  it("keeps runtime context attached to the user turn", () => {
    const context = {
      page: "review" as const,
      activePanel: "submissions" as const,
      problemId: "problem-two-sum",
    };

    expect(JSON.parse(buildAgentUserContent(context, "Why did this fail?"))).toEqual({
      runtimeContext: context,
      userMessage: "Why did this fail?",
    });
  });

  it("suggests a new session at 18 context runs and resets after compaction", () => {
    const session: AgentSession = {
      id: "session-1",
      userId: "user-1",
      title: "Review",
      status: "active",
      runCount: 18,
      summaryText: null,
      summarizedRunCount: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    expect(toAgentSessionDto(session)).toMatchObject({
      runCount: 18,
      contextRunCount: 18,
      suggestNewSession: true,
    });
    expect(toAgentSessionDto({
      ...session,
      runCount: 25,
      summaryText: "summary",
      summarizedRunCount: 16,
    })).toMatchObject({
      runCount: 25,
      contextRunCount: 9,
      suggestNewSession: false,
    });
  });

  it("keeps page-specific values out of the stable instructions", () => {
    expect(STUDY_COACH_INSTRUCTIONS).not.toContain("problem-two-sum");
    expect(STUDY_COACH_INSTRUCTIONS).not.toContain("active panel:");
  });

  it("loads a compressed summary before recent turns", () => {
    expect(buildCompressedSessionMessages("The user is reviewing Two Sum.")).toEqual([
      {
        role: "user",
        content: JSON.stringify({
          compressedSessionContext: "The user is reviewing Two Sum.",
        }),
      },
      { role: "assistant", content: "Compressed session context loaded." },
    ]);
  });

  it("combines the previous summary with the next compaction batch", () => {
    const context = {
      page: "review" as const,
      activePanel: "cards" as const,
      problemId: "problem-two-sum",
    };
    expect(JSON.parse(buildSessionSummaryPrompt("Previous", [
      { context, userMessage: "Question", assistantMessage: "Answer" },
    ]))).toEqual({
      previousSummary: "Previous",
      turns: [{ context, userMessage: "Question", assistantMessage: "Answer" }],
    });
  });

  it("removes old reasoning and tool context while preserving the final answer", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "private reasoning" },
          { type: "tool-call", toolCallId: "call-1", toolName: "read", input: {} },
          { type: "text", text: "Final answer" },
        ],
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "read",
          output: { type: "text", value: "large result" },
        }],
      },
    ] as unknown as ModelMessage[];

    expect(prepareAgentResponseMessages(messages, false)).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Final answer" }] },
    ]);
  });
});
