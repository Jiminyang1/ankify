import type { Problem, Submission } from "@ankify/db";
import type { CardDraft } from "@ankify/core";

const RAW_TEXT_MAX = 6000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n… (truncated)";
}

function fmtTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "time unknown";
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function buildAiCardPromptContext(args: {
  problem: Pick<
    Problem,
    "title" | "difficulty" | "topicTags" | "descriptionMd" | "url" | "leetcodeSlug" | "notes"
  >;
  submissions: Pick<
    Submission,
    | "language"
    | "code"
    | "status"
    | "errorMessage"
    | "failedTestcase"
    | "expectedOutput"
    | "actualOutput"
    | "submittedAt"
  >[];
  rawText: string;
}): Record<string, string> {
  const { problem, submissions, rawText } = args;

  const sectionALines: string[] = [];
  sectionALines.push("## A · 题目上下文（仅供参考，勿喧宾夺主）");
  sectionALines.push(`- **标题**：${problem.title}`);
  sectionALines.push(`- **难度**：${problem.difficulty}`);
  sectionALines.push(`- **Slug**：\`${problem.leetcodeSlug}\``);
  sectionALines.push(`- **链接**：${problem.url}`);
  if (problem.topicTags.length > 0) {
    sectionALines.push(`- **标签**：${problem.topicTags.join(", ")}`);
  }
  if (problem.notes?.trim()) {
    sectionALines.push("### 用户在题库页面写的备注（problem notes）");
    sectionALines.push(truncate(problem.notes.trim(), 1500));
  }

  if (problem.descriptionMd?.trim()) {
    sectionALines.push("### 题面节选（Markdown，可能截断）");
    sectionALines.push(truncate(problem.descriptionMd.trim(), 8000));
  } else {
    sectionALines.push("### 题面节选");
    sectionALines.push("_（抓取时暂无题面正文；请结合标题与标签理解题目意图。）_");
  }

  const SECTION_A = sectionALines.join("\n");

  const acceptedN = submissions.filter((s) => s.status === "Accepted").length;
  const failedN = submissions.length - acceptedN;

  const sectionBLines: string[] = [];
  sectionBLines.push("## B · 提交历史（从新到旧）");
  sectionBLines.push(
    `共 **${submissions.length}** 条记录（展示部分；其中 Accepted **${acceptedN}**，非通过 **${failedN}**）。` +
      "学生可能在 rawText 里引用「上一次」「那段递归」——在此对齐语境。",
  );

  const maxSubs = 10;
  const shown = submissions.slice(0, maxSubs);
  shown.forEach((s, i) => {
    const head = `[#${i + 1}] **${s.status}** · ${fmtTime(s.submittedAt)} · ${s.language}`;
    sectionBLines.push(head);
    if (s.status !== "Accepted") {
      const errBits = [s.errorMessage, s.failedTestcase && `(case) ${truncate(s.failedTestcase, 200)}`]
        .filter(Boolean)
        .join(" · ");
      if (errBits) sectionBLines.push(`  · ${truncate(errBits, 800)}`);
    }
    sectionBLines.push("```" + s.language);
    sectionBLines.push(truncate(s.code, 900));
    sectionBLines.push("```");
  });

  if (submissions.length > maxSubs) {
    sectionBLines.push(`_另有 ${submissions.length - maxSubs} 条更早提交未展开，仍以 rawText 为准。_`);
  }

  const SECTION_B = sectionBLines.join("\n");

  const rt = truncate(rawText.trim(), RAW_TEXT_MAX);
  const SECTION_C = "## C · 学生的原话（必须结构化的是这一段）\n\n" + rt;

  return { SECTION_A, SECTION_B, SECTION_C, RAW_TEXT: rt };
}

export function buildAiCardDraftPrompt(args: {
  problem: Parameters<typeof buildAiCardPromptContext>[0]["problem"];
  submissions: Parameters<typeof buildAiCardPromptContext>[0]["submissions"];
  action: "generate" | "followup";
  rawText?: string;
  draft?: Pick<CardDraft, "question" | "answer">;
  instruction?: string;
}): { system: string; user: string } {
  const vars = buildAiCardPromptContext({
    problem: args.problem,
    submissions: args.submissions,
    rawText: args.rawText ?? "",
  });

  const system = `你是 LeetCode 复习卡片编辑助手。你的输出会写入一张待确认候选卡，但不会进入复习队列。

核心原则：
- 卡片内容必须使用简体中文。
- 用户确认后才会成为正式卡片；你只帮忙生成或按 follow up 改写。
- 不要凭空发散成标准题解；题目和提交历史只用于理解语境。
- 只返回 question（正面）和 answer（背面）两个字段。
- question 和 answer 都支持 GitHub Flavored Markdown。
- Markdown 要克制使用：question 通常是一句主动回忆问题，可用 inline code 标记变量/函数；answer 可用短列表、inline code、必要时代码块。
- 不要使用 H1/H2/H3 标题，不要把 answer 写成完整题解长文。
- question 要适合主动回忆，直接问一个可检验的回忆点。
- answer 要直接、准确，能在复习时检验自己是否掌握。`;

  const actionLine =
    args.action === "generate"
      ? args.rawText?.trim()
        ? "任务：根据 C 里的原始想法生成一张可编辑复习卡草稿。"
        : "任务：根据题目上下文和提交历史自动生成一张可编辑复习卡草稿。"
      : "任务：根据用户 follow up 指令改写当前草稿，返回完整新草稿。";

  const user = [
    vars.SECTION_A,
    vars.SECTION_B,
    args.rawText?.trim() ? vars.SECTION_C : null,
    "## 当前草稿",
    args.draft
      ? `Q: ${args.draft.question}\nA: ${args.draft.answer}`
      : args.rawText?.trim()
        ? "_从原始想法生成。_"
        : "_暂无；系统将根据题目上下文生成。_",
    args.instruction?.trim() ? `## 用户 follow up 指令\n\n${args.instruction.trim()}` : null,
    actionLine,
    "只返回结构化字段。不要声称已经保存，不要解释你做了什么。",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
