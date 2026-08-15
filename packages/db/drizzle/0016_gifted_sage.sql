ALTER TABLE `agent_sessions` ADD `run_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `summary_text` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `summarized_run_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `agent_sessions`
SET `run_count` = (
	SELECT count(*) FROM `agent_runs` WHERE `agent_runs`.`session_id` = `agent_sessions`.`id`
);
