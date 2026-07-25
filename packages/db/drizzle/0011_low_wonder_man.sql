ALTER TABLE `problems` ADD `fsrs_learning_steps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_events` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `review_events` ADD `undone_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `review_events_user_request_unique` ON `review_events` (`user_id`,`request_id`);--> statement-breakpoint
UPDATE `quiz_sessions` AS `session`
SET `status` = 'archived', `updated_at` = (unixepoch() * 1000)
WHERE `session`.`status` <> 'archived'
  AND EXISTS (
    SELECT 1
    FROM `quiz_sessions` AS `newer`
    WHERE `newer`.`user_id` = `session`.`user_id`
      AND `newer`.`problem_id` = `session`.`problem_id`
      AND `newer`.`status` <> 'archived'
      AND (
        `newer`.`created_at` > `session`.`created_at`
        OR (`newer`.`created_at` = `session`.`created_at` AND `newer`.`id` > `session`.`id`)
      )
  );--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_sessions_user_problem_current_unique` ON `quiz_sessions` (`user_id`,`problem_id`) WHERE "quiz_sessions"."status" <> 'archived';
