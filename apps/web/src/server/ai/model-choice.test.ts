import { describe, expect, it } from "vitest";
import { applyModelChoice, coachModels } from "./model-choice";
import type { AiRuntimeSettings } from "../settings";

const user: AiRuntimeSettings = {
  provider: "deepseek",
  model: "deepseek-flash",
  reasoningLevel: "off",
  apiKey: "k",
  source: "user",
};

describe("applyModelChoice", () => {
  it("switches model and level on the user's own key", () => {
    expect(applyModelChoice(user, { id: "deepseek-v4-pro", reasoningLevel: "max" })).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      reasoningLevel: "max",
      apiKey: "k",
    });
  });

  it("drops a level the model doesn't accept", () => {
    expect(applyModelChoice(user, { id: "deepseek-v4-pro", reasoningLevel: "xhigh" }).reasoningLevel).toBe("default");
  });

  it("keeps the Settings level when only the same model is picked", () => {
    expect(applyModelChoice(user, { id: "deepseek-flash" }).reasoningLevel).toBe("off");
  });

  it("never changes the starter key's model", () => {
    const starter = { ...user, source: "starter" as const };
    expect(applyModelChoice(starter, { id: "deepseek-v4-pro", reasoningLevel: "max" })).toBe(starter);
  });
});

describe("coachModels", () => {
  it("lists the Settings model first, then the provider's suggestions", () => {
    const dto = coachModels({ ...user, model: "deepseek-v4-pro" });
    expect(dto.models.map((model) => model.id)).toEqual(["deepseek-v4-pro", "deepseek-flash"]);
    expect(dto.models[0]!.reasoningLevels).toEqual(["off", "low", "high", "max"]);
  });

  it("offers nothing to pick on the starter key", () => {
    expect(coachModels({ ...user, source: "starter" }).models).toEqual([]);
  });
});
