ALTER TABLE `practice_sessions` ADD `mode` text DEFAULT 'recall_check' NOT NULL;--> statement-breakpoint
ALTER TABLE `practice_sessions` ADD `targets_json` text;