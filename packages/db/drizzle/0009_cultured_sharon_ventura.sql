CREATE INDEX `cards_user_status_problem_idx` ON `cards` (`user_id`,`ai_status`,`problem_id`);--> statement-breakpoint
CREATE INDEX `problems_user_archived_due_idx` ON `problems` (`user_id`,`archived_at`,`fsrs_due`);--> statement-breakpoint
CREATE INDEX `review_events_user_type_occurred_idx` ON `review_events` (`user_id`,`event_type`,`occurred_at`);