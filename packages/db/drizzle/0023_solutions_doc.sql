ALTER TABLE `problems` ADD `solutions_md` text;--> statement-breakpoint
ALTER TABLE `problems` ADD `solutions_version` integer DEFAULT 0 NOT NULL;