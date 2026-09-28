# AI layer

How Ankify talks to language models, and where provider-specific behavior lives.

## Layers

```
Feature code   ai-generation/quiz.ts · ai-generation/card.ts · agent/runtime.ts · agent/compaction.ts · ai-connection.ts
                 │  asks for a model and "how to reason" (user setting or lightest)
                 ▼
Ankify layer   server/settings.ts      getAiRuntimeSettings(): the user's own key, or starter credits
               server/starter-ai.ts    starter-credit allowance
               server/ai.ts            getActiveModel() / buildModel()
               server/ai/call-options  aiCallOptions(): provider-native options for one call
               server/ai/errors        classifyProviderFailure(): one failure taxonomy for every provider
               server/ai/providers/    ← the only place provider names and quirks appear
                 registry.ts · anthropic.ts · openai.ts · deepseek.ts
                 ▼
Vercel AI SDK  messages, structured output (Output.object), tools, streaming
```

Feature code never branches on a provider. If you find yourself writing
`provider === "…"` outside `server/ai/providers/`, add a capability to the
adapter instead.

## Provider adapters

Each adapter (`ProviderAdapter` in `providers/types.ts`) declares:

- `createModel({ apiKey, model })`: the SDK client for this provider.
- `presets` and `aliases`: suggested model ids, and retired ids mapped to their
  replacements (applied when settings are read, so stored values keep working).
- `reasoningOptions(model, request)`: provider-native `providerOptions` for a
  reasoning request (see below). Model-level differences live here.
- `listModels(apiKey, signal)`: the provider's model-list endpoint.

Adding a provider is one adapter file plus one registry entry.

## Reasoning

Current models reason adaptively and default to thinking, so the normal call
sends **nothing** and uses the provider default. There are two requests:

| Request | Used by | Meaning |
|---|---|---|
| `default` | quizzes, cards, Study Coach, starter credits | Provider default (thinking on) |
| `lightest` | connection probe, session summaries | Cheapest setting the model accepts |

"Lightest" is not "off" everywhere, because not every model can turn thinking off:

| Provider / model | Lightest |
|---|---|
| DeepSeek | `thinking: { type: "disabled" }` |
| Claude Opus 5.5, Fable 5.x, Mythos, Sonnet 5.5 | `effort: "low"` (disabling is a 400) |
| Claude Opus 5, Opus 4.6–4.8, Sonnet 5, Sonnet 4.6 | `thinking: { type: "disabled" }` |
| Claude Haiku 4.5 | nothing (no thinking unless requested) |
| OpenAI reasoning models (gpt-5+, o-series) | `reasoningEffort: "low"` (`none` is rejected by some models) |

Adapters use each provider's own options instead of the SDK's generic
`reasoning` setting: the SDK maps `reasoning: "none"` to Anthropic
`thinking: disabled`, which current Claude models reject.

The legacy Settings switch (Fast / Thinking) is honored only for providers
whose adapter sets `legacyFastModeToggle` (DeepSeek); Fast maps to `lightest`.

## Sampling parameters

No call sends `temperature` or `top_p`. Thinking models ignore them (DeepSeek)
or reject them with a 400 (Claude Opus 4.7+, Sonnet 5+).

## Tool calling

Forced tool choice (`toolChoice: { type: "tool" }` / `"required"`) is a 400 on
current Claude models. Use `toolChoice: "auto"` and ask for the tool in the prompt.

## Errors

`classifyProviderFailure()` maps any provider error to one of
`invalid_api_key · forbidden · model_not_found · quota_exceeded · rate_limited ·
provider_unavailable · bad_request · timeout · network · unknown`, using the
HTTP status on the SDK's `APICallError`. Generation jobs retry only transient
failures; the probe and model list turn the same codes into user-facing messages.

## Verified behavior (2026-09)

Checked against the DeepSeek QA key: thinking on by default and off with
`thinking: disabled`; quiz generation and multi-turn Study Coach tool use in
thinking mode (dropping reasoning between turns causes no errors); the
connection probe; retired model ids resolving to `deepseek-flash`. Anthropic
and OpenAI mappings follow their current documentation and are unit tested,
not yet exercised against live keys.
