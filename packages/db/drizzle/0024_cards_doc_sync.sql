-- The web app stops reading card rows (docs/coach-practice.md, stage 3): the
-- Cards doc is the only copy. Ready cards written as rows after
-- 0019_cards_to_docs (manual and AI cards made on the web) are appended to
-- the doc, oldest first, unless the doc already has a card with that prompt.
-- The rows stay for export and older extension builds.
UPDATE `problems`
SET
  `cards_md` = coalesce(nullif(rtrim(`cards_md`, char(10)), '') || char(10) || char(10), '') || (
    SELECT group_concat(`block`, char(10) || char(10)) || char(10)
    FROM (
      SELECT '## ' || `c`.`prompt` || char(10) || trim(`c`.`answer`) AS `block`
      FROM (
        SELECT `id`, `problem_id`, `answer`, `created_at`, `ai_status`,
          trim(replace(replace(`question`, char(13), ' '), char(10), ' ')) AS `prompt`
        FROM `cards`
      ) AS `c`
      WHERE `c`.`problem_id` = `problems`.`id` AND `c`.`ai_status` = 'ready'
        AND instr(char(10) || coalesce(`problems`.`cards_md`, ''), char(10) || '## ' || `c`.`prompt` || char(10)) = 0
      ORDER BY `c`.`created_at`, `c`.`id`
    )
  ),
  `cards_version` = `cards_version` + 1
WHERE EXISTS (
  SELECT 1 FROM `cards` AS `c`
  WHERE `c`.`problem_id` = `problems`.`id` AND `c`.`ai_status` = 'ready'
    AND instr(
      char(10) || coalesce(`problems`.`cards_md`, ''),
      char(10) || '## ' || trim(replace(replace(`c`.`question`, char(13), ' '), char(10), ' ')) || char(10)
    ) = 0
);
