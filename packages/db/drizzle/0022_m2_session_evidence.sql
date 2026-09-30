CREATE TABLE `practice_improvements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`practice_session_id` text NOT NULL,
	`category` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practice_session_id`,`user_id`,`problem_id`) REFERENCES `practice_sessions`(`id`,`user_id`,`problem_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_improvements_user_request_unique` ON `practice_improvements` (`user_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_improvements_session_category_unique` ON `practice_improvements` (`user_id`,`practice_session_id`,`category`);--> statement-breakpoint
CREATE INDEX `practice_improvements_user_created_idx` ON `practice_improvements` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `mistake_records` ADD `practice_session_id` text REFERENCES practice_sessions(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `mistake_records` ADD `evidence` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `mistake_records_session_dedup_unique` ON `mistake_records` (`user_id`,`practice_session_id`,`primary_category`,`origin`) WHERE "mistake_records"."source_type" = 'practice_session' AND "mistake_records"."practice_session_id" IS NOT NULL AND "mistake_records"."status" <> 'dismissed';--> statement-breakpoint
CREATE INDEX `mistake_records_user_session_idx` ON `mistake_records` (`user_id`,`practice_session_id`);