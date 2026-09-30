CREATE TABLE `session_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`practice_session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`evidence_digest` text NOT NULL,
	`analyzer_version` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`result` text NOT NULL,
	`coverage` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practice_session_id`,`user_id`,`problem_id`) REFERENCES `practice_sessions`(`id`,`user_id`,`problem_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_analyses_cache_unique` ON `session_analyses` (`user_id`,`practice_session_id`,`evidence_digest`,`analyzer_version`,`provider`,`model`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_analyses_job_unique` ON `session_analyses` (`job_id`);--> statement-breakpoint
CREATE INDEX `session_analyses_user_session_created_idx` ON `session_analyses` (`user_id`,`practice_session_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `practice_session_id` text REFERENCES practice_sessions(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `evidence_digest` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `trigger` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `result_analysis_id` text REFERENCES session_analyses(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `dispatched_at` integer;--> statement-breakpoint
CREATE INDEX `ai_jobs_user_action_created_idx` ON `ai_jobs` (`user_id`,`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_jobs_user_session_idx` ON `ai_jobs` (`user_id`,`practice_session_id`);--> statement-breakpoint
ALTER TABLE `mistake_records` ADD `analysis_id` text REFERENCES session_analyses(id) ON DELETE set null;