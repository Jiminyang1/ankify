CREATE TABLE `attempt_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`source_account` text,
	`observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_history_user_slug_source_unique` ON `attempt_history` (`user_id`,`slug`,`source`);--> statement-breakpoint
CREATE TABLE `attempt_history_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`source_account` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`complete` integer DEFAULT false NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_history_coverage_user_scope_account_unique` ON `attempt_history_coverage` (`user_id`,`scope`,`source_account`);--> statement-breakpoint
CREATE TABLE `suggestion_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`difficulty` text NOT NULL,
	`paid_only` integer NOT NULL,
	`topic_tags` text DEFAULT '[]' NOT NULL,
	`source` text NOT NULL,
	`verified_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_candidates_user_slug_unique` ON `suggestion_candidates` (`user_id`,`slug`);