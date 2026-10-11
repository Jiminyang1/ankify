ALTER TABLE `problems` ADD `notes_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `problems` ADD `cards_md` text;--> statement-breakpoint
ALTER TABLE `problems` ADD `cards_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `problems` ADD `card_stats` text DEFAULT '{}' NOT NULL;