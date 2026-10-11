CREATE TABLE `practice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`agent_run_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`recall_json` text NOT NULL,
	`check_status` text NOT NULL,
	`check_message` text,
	`check_job_id` text,
	`check_json` text,
	`results_json` text DEFAULT '{"recall":{},"check":{}}' NOT NULL,
	`score` real,
	`suggested_rating` integer,
	`debriefed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `practice_sessions_user_problem_idx` ON `practice_sessions` (`user_id`,`problem_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `practice_sessions_user_problem_active_unique` ON `practice_sessions` (`user_id`,`problem_id`) WHERE "practice_sessions"."status" = 'active';--> statement-breakpoint
ALTER TABLE `agent_steps` ADD `practice_session_id` text REFERENCES practice_sessions(id) ON DELETE set null;