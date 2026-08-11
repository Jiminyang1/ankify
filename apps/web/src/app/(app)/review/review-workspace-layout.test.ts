import { describe, expect, it } from "vitest";
import type { Model } from "flexlayout-react";
import { createReviewWorkspaceModel } from "./review-workspace-layout";

const labels = {
  layouts: "Layouts",
  question: "Question",
  study: "Study",
  coach: "Study Coach",
  show: "Show",
  hide: "Hide",
  reset: "Reset",
};

describe("review workspace layout", () => {
  it("restores the saved model directly without adopting a mounted model", () => {
    const initial = createReviewWorkspaceModel(null, labels, true);
    const restored = createReviewWorkspaceModel(initial.model.toJson(), labels, false);

    expect(restored.coachOpen).toBe(true);
    expect(
      (restored.model as Model & { getAdoptedFromModel(): Model | undefined })
        .getAdoptedFromModel(),
    ).toBeUndefined();
  });
});
