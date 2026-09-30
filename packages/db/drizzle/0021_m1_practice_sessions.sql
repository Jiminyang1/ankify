CREATE TABLE `practice_session_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`command` text NOT NULL,
	`payload_digest` text NOT NULL,
	`response` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `practice_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_session_commands_user_request_unique` ON `practice_session_commands` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `practice_session_commands_session_idx` ON `practice_session_commands` (`session_id`);--> statement-breakpoint
CREATE TABLE `practice_session_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`source_site` text DEFAULT 'leetcode.com' NOT NULL,
	`leetcode_submission_id` text,
	`client_observation_id` text,
	`submission_id` text,
	`verdict` text NOT NULL,
	`submitted_at` integer,
	`first_observed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`detail_status` text NOT NULL,
	`association` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`,`user_id`,`problem_id`) REFERENCES `practice_sessions`(`id`,`user_id`,`problem_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "practice_session_submissions_identity" CHECK("practice_session_submissions"."leetcode_submission_id" IS NOT NULL OR "practice_session_submissions"."client_observation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_session_submissions_user_site_lc_unique` ON `practice_session_submissions` (`user_id`,`source_site`,`leetcode_submission_id`) WHERE "practice_session_submissions"."leetcode_submission_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `practice_session_submissions_user_client_obs_unique` ON `practice_session_submissions` (`user_id`,`client_observation_id`) WHERE "practice_session_submissions"."client_observation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `practice_session_submissions_session_idx` ON `practice_session_submissions` (`session_id`,`first_observed_at`);--> statement-breakpoint
CREATE TABLE `practice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`request_id` text NOT NULL,
	`type` text NOT NULL,
	`review_method` text DEFAULT 'leetcode_full_solve' NOT NULL,
	`review_intent` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_open` integer DEFAULT true NOT NULL,
	`outcome` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`schedule_revision_at_start` integer NOT NULL,
	`rating_disposition` text DEFAULT 'not_applicable' NOT NULL,
	`rating_expires_at` integer,
	`source_site` text DEFAULT 'leetcode.com' NOT NULL,
	`source_account` text,
	`owner_token` text,
	`owner_lease_expires_at` integer,
	`baseline_state` text DEFAULT 'pending' NOT NULL,
	`baseline_submission_id` text,
	`capture_completeness` text DEFAULT 'complete' NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`observed_ms` integer DEFAULT 0 NOT NULL,
	`owner_active_ms` integer DEFAULT 0 NOT NULL,
	`owner_observed_ms` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_activity_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`completed_at_adjusted` integer DEFAULT false NOT NULL,
	`completion_received_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_sessions_user_request_unique` ON `practice_sessions` (`user_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_sessions_id_owner_unique` ON `practice_sessions` (`id`,`user_id`,`problem_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_sessions_user_problem_open_unique` ON `practice_sessions` (`user_id`,`problem_id`) WHERE "practice_sessions"."is_open" = 1;--> statement-breakpoint
CREATE INDEX `practice_sessions_user_started_idx` ON `practice_sessions` (`user_id`,`started_at`,`id`);--> statement-breakpoint
CREATE INDEX `practice_sessions_user_problem_started_idx` ON `practice_sessions` (`user_id`,`problem_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `practice_sessions_user_rating_idx` ON `practice_sessions` (`user_id`,`rating_disposition`,`rating_expires_at`);--> statement-breakpoint
ALTER TABLE `problems` ADD `schedule_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `problems` ADD `enrollment` text DEFAULT 'enrolled' NOT NULL;--> statement-breakpoint
ALTER TABLE `review_events` ADD `practice_session_id` text REFERENCES practice_sessions(id);--> statement-breakpoint
ALTER TABLE `review_events` ADD `policy_version` text;--> statement-breakpoint
ALTER TABLE `review_events` ADD `review_method` text;--> statement-breakpoint
ALTER TABLE `review_events` ADD `schedule_revision` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `review_events_session_scheduling_unique` ON `review_events` (`practice_session_id`,`event_type`) WHERE "review_events"."practice_session_id" IS NOT NULL AND "review_events"."event_type" IN ('self_recall_rated', 'fsrs_scheduled');--> statement-breakpoint
CREATE INDEX `submissions_user_lc_submission_idx` ON `submissions` (`user_id`,`leetcode_submission_id`);