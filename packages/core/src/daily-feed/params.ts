/**
 * Every tunable constant of the daily practice feed. See
 * docs/DAILY_FEED_PLAN.md for what each one means and why it has this value.
 */
export const FEED_PARAMS = {
  /** Evidence loses half its weight every 21 days and is ignored after 90. */
  halfLifeDays: 21,
  maxEvidenceAgeDays: 90,
  weights: {
    mistake: 3,
    resolvedMistakeFactor: 0.25,
    quizWrong: 1,
    quizRight: 1,
    feedFailed: 2,
    feedShaky: 1,
    feedClean: 2,
    feedQuizIncorrect: 1,
    feedQuizCorrect: 1,
    ratingAgain: 1.5,
    ratingHard: 0.5,
    ratingPass: 0.75,
  },
  /** Beta prior strength pulling a sparse dimension toward the user's overall rate. */
  priorStrength: 3,
  globalRateMin: 0.15,
  globalRateMax: 0.6,
  /** Confidence `F / (F + k)`: how much failure evidence a weakness rests on. */
  confidenceK: 2,
  weakEnter: 0.25,
  weakExit: 0.15,
  /** A dimension served as weak this recently stays weak until it drops below `weakExit`. */
  hysteresisDays: 14,
  /** A dimension weak this recently, but not now, is "recovered" and gets check-ups. */
  recoveredWindowDays: 30,
  /** Served counts for the deficit round-robin look back this far. */
  allocationWindowDays: 14,
  weakPoolShare: 0.85,
  checkupShare: 0.15,
  shareCap: 0.6,
  shareFloor: 0.15,
  kindShares: { problem_drill: 0.5, quiz_retry: 0.25, new_problem: 0.25 },
  maxNewProblemsPerDay: 1,
  /** Problems due within this many days are left to their scheduled review. */
  dueSoonDays: 3,
  recentReviewDays: 2,
  problemCooldownDays: 7,
  newProblemCooldownDays: 30,
  quizMissMinAgeDays: 2,
  topTopicsForNewProblems: 3,
  maxDailyItems: 5,
  /** Retrievability below this adds a `forgetting_risk` reason to a drill. */
  forgettingRiskBelow: 0.7,
  score: {
    affinity: 2,
    direct: 1,
    forgetting: 1,
    topicWeakness: 0.5,
    lapses: 0.25,
    jitter: 0.1,
    difficultyFit: 0.5,
  },
};

export type FeedParams = typeof FEED_PARAMS;
