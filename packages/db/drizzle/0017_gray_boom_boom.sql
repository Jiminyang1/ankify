CREATE TABLE `ai_credit_balances` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_credit_balances_balance_non_negative" CHECK("ai_credit_balances"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE `ai_credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bucket` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_credit_ledger_user_created_idx` ON `ai_credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_credit_ledger_reason_ref_unique` ON `ai_credit_ledger` (`reason`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `credit_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`stripe_payment_intent_id` text,
	`pack_id` text NOT NULL,
	`credits` integer NOT NULL,
	`amount_total` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`refunded_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_purchases_checkout_session_unique` ON `credit_purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_payment_intent_idx` ON `credit_purchases` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_user_created_idx` ON `credit_purchases` (`user_id`,`created_at`);