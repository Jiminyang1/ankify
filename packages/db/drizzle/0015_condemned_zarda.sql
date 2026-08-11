CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_messages_session_created_idx` ON `agent_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_run_role_unique` ON `agent_messages` (`run_id`,`role`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`context_json` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`response_messages_json` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_user_request_unique` ON `agent_runs` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_session_started_idx` ON `agent_runs` (`session_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_session_running_unique` ON `agent_runs` (`session_id`) WHERE "agent_runs"."status" = 'running';--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_user_updated_idx` ON `agent_sessions` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `agent_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`tool_name` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`navigation_json` text,
	`proposal_json` text,
	`ai_job_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_steps_run_sequence_unique` ON `agent_steps` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `agent_steps_user_status_idx` ON `agent_steps` (`user_id`,`status`);