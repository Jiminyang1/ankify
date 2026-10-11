CREATE TABLE `weakness_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weakness_categories_user_key_unique` ON `weakness_categories` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `weaknesses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`category` text NOT NULL,
	`detail` text NOT NULL,
	`evidence_json` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`hit_count` integer DEFAULT 1 NOT NULL,
	`correct_streak` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`resolved_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `weaknesses_user_problem_idx` ON `weaknesses` (`user_id`,`problem_id`,`status`);--> statement-breakpoint
CREATE INDEX `weaknesses_user_category_idx` ON `weaknesses` (`user_id`,`category`,`status`);--> statement-breakpoint
ALTER TABLE `agent_steps` ADD `weakness_id` text REFERENCES weaknesses(id) ON DELETE set null;