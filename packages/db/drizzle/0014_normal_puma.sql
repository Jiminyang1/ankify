CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`kind` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`idempotency_key` text NOT NULL,
	`active_dedup_key` text,
	`input_envelope` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_mode` text NOT NULL,
	`generation_language` text NOT NULL,
	`expected_card_id` text,
	`expected_card_version` integer,
	`expected_quiz_session_id` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`worker_id` text,
	`lease_expires_at` integer,
	`cancel_requested_at` integer,
	`result_card_id` text,
	`result_quiz_session_id` text,
	`error_code` text,
	`error_message` text,
	`queued_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`result_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`result_quiz_session_id`) REFERENCES `quiz_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_jobs_user_idx` ON `ai_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `ai_jobs_user_status_created_idx` ON `ai_jobs` (`user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_jobs_status_run_after_idx` ON `ai_jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `ai_jobs_problem_status_idx` ON `ai_jobs` (`problem_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_user_idempotency_unique` ON `ai_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_user_active_dedup_unique` ON `ai_jobs` (`user_id`,`active_dedup_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_jobs_user_running_unique` ON `ai_jobs` (`user_id`) WHERE `ai_jobs`.`status` = 'running';--> statement-breakpoint
ALTER TABLE `cards` ADD `version` integer DEFAULT 1 NOT NULL;
