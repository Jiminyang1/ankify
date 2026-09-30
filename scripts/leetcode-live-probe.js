/*
 * Live LeetCode integration probe (read-only).
 *
 * Validates the GraphQL fields the extension relies on against a real,
 * signed-in session: submission ids and ordering, pagination, missing
 * details, account identity, per-question attempt status, and
 * similar-question metadata. Fixtures cannot substitute for this check.
 *
 * Usage: open https://leetcode.com/problems/<slug>/ for a problem you have
 * submitted to at least a few times (ideally 21+ submissions to exercise a
 * second page), paste this whole file into the DevTools console, and press
 * Enter. A JSON report is printed and copied to the clipboard.
 *
 * Only queries are sent, never mutations. The report contains field shapes,
 * counts, and booleans; it never includes code, usernames, submission ids,
 * or test data.
 */
(async () => {
  const slug = location.pathname.match(/^\/problems\/([^/]+)/)?.[1];
  if (location.origin !== "https://leetcode.com" || !slug) {
    console.error("Open a https://leetcode.com/problems/<slug>/ page first.");
    return;
  }
  const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];

  async function gql(query, variables = {}) {
    const response = await fetch("/graphql/", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...(csrf ? { "x-csrftoken": decodeURIComponent(csrf) } : {}) },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* reported below */ }
    return {
      httpStatus: response.status,
      data: json?.data ?? null,
      errors: json?.errors?.map((error) => String(error.message).slice(0, 160)) ?? (json ? [] : ["non-JSON response"]),
    };
  }
  const shape = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const shapes = (object) => object ? Object.fromEntries(Object.entries(object).map(([key, value]) => [key, shape(value)])) : null;
  const report = { probeVersion: 1, ranAt: new Date().toISOString(), csrfCookiePresent: Boolean(csrf) };

  // 1. Account identity.
  const status = await gql(`query { userStatus { isSignedIn username userSlug isPremium } }`);
  const username = status.data?.userStatus?.username ?? null;
  report.userStatus = {
    httpStatus: status.httpStatus, errors: status.errors,
    isSignedIn: status.data?.userStatus?.isSignedIn ?? null,
    fieldShapes: shapes(status.data?.userStatus),
  };

  // 2. Submission list: fields, ordering, and pagination by offset and lastKey.
  const listQuery = `query Q($questionSlug: String!, $offset: Int!, $limit: Int!, $lastKey: String) {
    questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit, lastKey: $lastKey) {
      lastKey hasNext
      submissions { id title titleSlug status statusDisplay lang langName runtime memory timestamp url isPending }
    }
  }`;
  const page1 = await gql(listQuery, { questionSlug: slug, offset: 0, limit: 20, lastKey: null });
  const list1 = page1.data?.questionSubmissionList;
  const subs1 = list1?.submissions ?? [];
  const ids1 = subs1.map((s) => String(s.id));
  const summarizeList = (subs) => ({
    count: subs.length,
    allIdsNumericStrings: subs.every((s) => typeof s.id === "string" && /^\d+$/.test(s.id)),
    idsUnique: new Set(subs.map((s) => s.id)).size === subs.length,
    timestampsDescending: subs.every((s, i) => i === 0 || Number(subs[i - 1].timestamp) >= Number(s.timestamp)),
    idsDescendWithTime: subs.every((s, i) => i === 0 || Number(subs[i - 1].id) > Number(s.id)),
    titleSlugMatchesPage: subs.every((s) => s.titleSlug === slug),
    statusDisplayValues: [...new Set(subs.map((s) => s.statusDisplay))],
    statusCodes: [...new Set(subs.map((s) => s.status))],
    isPendingValues: [...new Set(subs.map((s) => String(s.isPending)))],
    timestampShape: subs[0] ? shape(subs[0].timestamp) : null,
  });
  report.submissionListPage1 = {
    httpStatus: page1.httpStatus, errors: page1.errors,
    hasNext: list1?.hasNext ?? null, lastKeyShape: shape(list1?.lastKey ?? null),
    submissionFieldShapes: shapes(subs1[0]), ...summarizeList(subs1),
  };
  if (list1?.hasNext) {
    const byKey = await gql(listQuery, { questionSlug: slug, offset: 20, limit: 20, lastKey: list1.lastKey ?? null });
    const byOffset = await gql(listQuery, { questionSlug: slug, offset: 20, limit: 20, lastKey: null });
    const keyed = byKey.data?.questionSubmissionList?.submissions ?? [];
    const offsetOnly = byOffset.data?.questionSubmissionList?.submissions ?? [];
    report.submissionListPage2 = {
      withLastKey: { httpStatus: byKey.httpStatus, errors: byKey.errors, overlapsPage1: keyed.some((s) => ids1.includes(String(s.id))), continuesBelowPage1: keyed.every((s) => Number(s.id) < Math.min(...ids1.map(Number))), ...summarizeList(keyed) },
      offsetOnly: { httpStatus: byOffset.httpStatus, errors: byOffset.errors, sameAsWithLastKey: JSON.stringify(offsetOnly.map((s) => s.id)) === JSON.stringify(keyed.map((s) => s.id)), count: offsetOnly.length },
    };
  } else {
    report.submissionListPage2 = "not exercised: fewer than 21 submissions on this problem";
  }
  const legacy = await gql(`query Q($questionSlug: String!, $offset: Int!, $limit: Int!) {
    submissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) { lastKey hasNext submissions { id statusDisplay timestamp } }
  }`, { questionSlug: slug, offset: 0, limit: 5 });
  report.legacySubmissionList = { httpStatus: legacy.httpStatus, errors: legacy.errors, count: legacy.data?.submissionList?.submissions?.length ?? null };

  // 3. Submission details for the newest owned submission and a foreign id.
  const detailQuery = `query Q($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      code timestamp statusCode runtimeDisplay memoryDisplay totalCorrect totalTestcases
      lang { name verboseName } question { questionId titleSlug } user { username }
      lastTestcase codeOutput expectedOutput runtimeError compileError notes
    }
  }`;
  if (ids1[0]) {
    const own = await gql(detailQuery, { submissionId: Number(ids1[0]) });
    const detail = own.data?.submissionDetails ?? null;
    const failed = subs1.find((s) => s.statusDisplay !== "Accepted");
    const failedDetail = failed ? (await gql(detailQuery, { submissionId: Number(failed.id) })).data?.submissionDetails ?? null : null;
    report.submissionDetailsOwn = {
      httpStatus: own.httpStatus, errors: own.errors, returnedNull: detail === null,
      fieldShapes: shapes(detail), langShapes: shapes(detail?.lang), questionShapes: shapes(detail?.question),
      questionTitleSlugMatchesPage: detail?.question?.titleSlug === slug,
      userMatchesSignedInAccount: detail?.user ? detail.user.username === username : null,
      timestampMatchesList: detail ? Number(detail.timestamp) === Number(subs1[0].timestamp) : null,
      codeLength: typeof detail?.code === "string" ? detail.code.length : null,
      failedSubmission: failed ? { statusDisplay: failed.statusDisplay, fieldShapes: shapes(failedDetail) } : "none among the latest 20",
    };
  }
  const foreign = await gql(detailQuery, { submissionId: 1 });
  report.submissionDetailsForeignId = { httpStatus: foreign.httpStatus, errors: foreign.errors, returnedNull: foreign.data?.submissionDetails === null };

  // 4. Question metadata: per-question attempt status and similar questions.
  const question = await gql(`query Q($slug: String!) {
    question(titleSlug: $slug) { questionId questionFrontendId title titleSlug difficulty isPaidOnly status similarQuestions topicTags { slug name } }
  }`, { slug });
  const q = question.data?.question ?? null;
  let similar = null;
  try { similar = JSON.parse(q?.similarQuestions ?? "null"); } catch { similar = "unparseable"; }
  report.question = {
    httpStatus: question.httpStatus, errors: question.errors, fieldShapes: shapes(q),
    statusValue: q?.status ?? null,
    similarQuestions: Array.isArray(similar) ? { count: similar.length, itemKeys: similar[0] ? Object.keys(similar[0]) : [], difficultyValues: [...new Set(similar.map((s) => s.difficulty))], paidOnlyShape: similar[0] ? shape(similar[0].isPaidOnly) : null } : similar,
  };
  const unattempted = await gql(`query { question(titleSlug: "two-sum") { status } }`);
  report.questionStatusSample = { twoSumStatus: unattempted.data?.question?.status ?? null, errors: unattempted.errors };

  // 5. Bulk attempt history via the problem list's status filter.
  const bulk = {};
  for (const filter of ["AC", "TRIED"]) {
    const result = await gql(`query Q($filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(categorySlug: "", limit: 5, skip: 0, filters: $filters) {
        total: totalNum
        questions: data { titleSlug status isPaidOnly difficulty }
      }
    }`, { filters: { status: filter } });
    const questions = result.data?.problemsetQuestionList?.questions ?? [];
    bulk[filter] = { httpStatus: result.httpStatus, errors: result.errors, total: result.data?.problemsetQuestionList?.total ?? null, statusValues: [...new Set(questions.map((x) => x.status))], itemShapes: shapes(questions[0]) };
  }
  report.bulkAttemptHistory = bulk;

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  try { copy(json); console.log("Report copied to the clipboard."); } catch { console.log("Copy the report above."); }
})();
