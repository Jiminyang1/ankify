UPDATE `problems`
SET `leetcode_id` = NULL
WHERE `leetcode_id` IS NOT NULL
  AND `id` NOT IN (
    SELECT MIN(`id`)
    FROM `problems`
    WHERE `leetcode_id` IS NOT NULL
    GROUP BY `leetcode_id`
  );
