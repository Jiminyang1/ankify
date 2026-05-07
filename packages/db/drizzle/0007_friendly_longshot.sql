PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `review_events`;--> statement-breakpoint
DROP TABLE IF EXISTS `quiz_sessions`;--> statement-breakpoint
DROP TABLE IF EXISTS `cards`;--> statement-breakpoint
DROP TABLE IF EXISTS `submissions`;--> statement-breakpoint
DROP TABLE IF EXISTS `settings`;--> statement-breakpoint
DROP TABLE IF EXISTS `problems`;--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT 0 NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`account_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_unique` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`rate_limit_enabled` integer DEFAULT 1 NOT NULL,
	`rate_limit_time_window` integer DEFAULT 86400000 NOT NULL,
	`rate_limit_max` integer DEFAULT 1000 NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`permissions` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `apikey_reference_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `apikey_key_unique` ON `apikey` (`key`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`leetcode_slug` text NOT NULL,
	`leetcode_id` integer,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`url` text NOT NULL,
	`description_md` text,
	`topic_tags` text DEFAULT (json('[]')) NOT NULL,
	`similar_slugs` text DEFAULT (json('[]')) NOT NULL,
	`notes` text,
	`fsrs_due` integer,
	`fsrs_stability` real,
	`fsrs_difficulty` real,
	`fsrs_elapsed_days` real,
	`fsrs_scheduled_days` real,
	`fsrs_reps` integer DEFAULT 0 NOT NULL,
	`fsrs_lapses` integer DEFAULT 0 NOT NULL,
	`fsrs_state` text DEFAULT 'new' NOT NULL,
	`fsrs_last_review` integer,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problems_user_idx` ON `problems` (`user_id`);--> statement-breakpoint
CREATE INDEX `problems_fsrs_due_idx` ON `problems` (`fsrs_due`);--> statement-breakpoint
CREATE INDEX `problems_slug_idx` ON `problems` (`leetcode_slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `problems_user_slug_unique` ON `problems` (`user_id`,`leetcode_slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `problems_user_leetcode_id_unique` ON `problems` (`user_id`,`leetcode_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`language` text NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`runtime_ms` integer,
	`memory_kb` integer,
	`failed_testcase` text,
	`expected_output` text,
	`actual_output` text,
	`error_message` text,
	`submitted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submissions_user_idx` ON `submissions` (`user_id`);--> statement-breakpoint
CREATE INDEX `submissions_problem_idx` ON `submissions` (`problem_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`ai_status` text DEFAULT 'ready' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cards_user_idx` ON `cards` (`user_id`);--> statement-breakpoint
CREATE INDEX `cards_problem_idx` ON `cards` (`problem_id`);--> statement-breakpoint
CREATE INDEX `cards_ai_status_idx` ON `cards` (`ai_status`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`event_type` text NOT NULL,
	`fsrs_rating` integer,
	`card_id` text,
	`submission_id` text,
	`fsrs_stability_snap` real,
	`fsrs_difficulty_snap` real,
	`fsrs_retrievability_snap` real,
	`metadata` text,
	`occurred_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_events_user_idx` ON `review_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `review_events_problem_idx` ON `review_events` (`problem_id`);--> statement-breakpoint
CREATE INDEX `review_events_type_idx` ON `review_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `review_events_occurred_idx` ON `review_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `quiz_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`items_json` text NOT NULL,
	`answers_json` text DEFAULT (json('[]')) NOT NULL,
	`score` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_sessions_user_idx` ON `quiz_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `quiz_sessions_problem_idx` ON `quiz_sessions` (`problem_id`);--> statement-breakpoint
CREATE INDEX `quiz_sessions_status_idx` ON `quiz_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `settings_user_idx` ON `settings` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
