CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`ai_status` text DEFAULT 'ready' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cards_problem_idx` ON `cards` (`problem_id`);--> statement-breakpoint
CREATE INDEX `cards_ai_status_idx` ON `cards` (`ai_status`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
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
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problems_leetcode_slug_unique` ON `problems` (`leetcode_slug`);--> statement-breakpoint
CREATE INDEX `problems_fsrs_due_idx` ON `problems` (`fsrs_due`);--> statement-breakpoint
CREATE INDEX `problems_slug_idx` ON `problems` (`leetcode_slug`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_events_problem_idx` ON `review_events` (`problem_id`);--> statement-breakpoint
CREATE INDEX `review_events_type_idx` ON `review_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `review_events_occurred_idx` ON `review_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submissions_problem_idx` ON `submissions` (`problem_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);