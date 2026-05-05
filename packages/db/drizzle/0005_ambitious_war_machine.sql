CREATE TABLE `quiz_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`items_json` text NOT NULL,
	`answers_json` text DEFAULT (json('[]')) NOT NULL,
	`score` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_sessions_problem_idx` ON `quiz_sessions` (`problem_id`);--> statement-breakpoint
CREATE INDEX `quiz_sessions_status_idx` ON `quiz_sessions` (`status`);