-- Cards move from rows into each problem's Cards doc (docs/coach-practice.md):
-- one "## question" block per ready card, oldest first. Only problems whose
-- doc is still empty are filled; the card rows stay as they are.
UPDATE `problems`
SET
  `cards_md` = (
    SELECT group_concat(`block`, char(10) || char(10)) || char(10)
    FROM (
      SELECT '## ' || trim(replace(replace(`c`.`question`, char(13), ' '), char(10), ' ')) || char(10) || trim(`c`.`answer`) AS `block`
      FROM `cards` AS `c`
      WHERE `c`.`problem_id` = `problems`.`id` AND `c`.`ai_status` = 'ready'
      ORDER BY `c`.`created_at`, `c`.`id`
    )
  ),
  `cards_version` = `cards_version` + 1
WHERE `cards_md` IS NULL
  AND EXISTS (
    SELECT 1 FROM `cards` AS `c`
    WHERE `c`.`problem_id` = `problems`.`id` AND `c`.`ai_status` = 'ready'
  );
