CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date_key` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`replaces_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`topic_tags` text DEFAULT '[]' NOT NULL,
	`category` text,
	`lane` text NOT NULL,
	`reasons` text NOT NULL,
	`planner_version` text NOT NULL,
	`verified_at` integer NOT NULL,
	`novelty` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`practice_session_id` text,
	`request_id` text NOT NULL,
	`action_request_id` text,
	`acted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`practice_session_id`) REFERENCES `practice_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_user_date_ordinal_unique` ON `suggestions` (`user_id`,`date_key`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_user_request_unique` ON `suggestions` (`user_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_user_pending_slug_unique` ON `suggestions` (`user_id`,`slug`) WHERE "suggestions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `suggestions_user_created_idx` ON `suggestions` (`user_id`,`created_at`);