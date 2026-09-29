CREATE TABLE `mistake_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`primary_category` text NOT NULL,
	`secondary_tags` text DEFAULT (json('[]')) NOT NULL,
	`summary` text,
	`next_step` text,
	`source_type` text NOT NULL,
	`submission_id` text,
	`quiz_session_id` text,
	`quiz_item_id` text,
	`review_event_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`origin` text DEFAULT 'user' NOT NULL,
	`request_id` text NOT NULL,
	`resolved_at` integer,
	`confirmed_at` integer,
	`dismissed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`quiz_session_id`) REFERENCES `quiz_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`review_event_id`) REFERENCES `review_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mistake_records_user_request_unique` ON `mistake_records` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `mistake_records_user_status_created_idx` ON `mistake_records` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `mistake_records_user_category_created_idx` ON `mistake_records` (`user_id`,`primary_category`,`created_at`);--> statement-breakpoint
CREATE INDEX `mistake_records_user_problem_idx` ON `mistake_records` (`user_id`,`problem_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mistake_records_submission_dedup_unique` ON `mistake_records` (`user_id`,`submission_id`,`primary_category`) WHERE "mistake_records"."submission_id" IS NOT NULL AND "mistake_records"."status" <> 'dismissed';--> statement-breakpoint
CREATE UNIQUE INDEX `mistake_records_quiz_dedup_unique` ON `mistake_records` (`user_id`,`quiz_session_id`,`quiz_item_id`,`primary_category`) WHERE "mistake_records"."quiz_session_id" IS NOT NULL AND "mistake_records"."status" <> 'dismissed';--> statement-breakpoint
CREATE UNIQUE INDEX `mistake_records_review_dedup_unique` ON `mistake_records` (`user_id`,`review_event_id`,`primary_category`) WHERE "mistake_records"."review_event_id" IS NOT NULL AND "mistake_records"."status" <> 'dismissed';