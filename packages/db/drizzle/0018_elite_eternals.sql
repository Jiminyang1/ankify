PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bucket` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_ai_credit_ledger`("id", "user_id", "bucket", "delta", "reason", "ref_type", "ref_id", "created_at") SELECT "id", "user_id", "bucket", "delta", "reason", "ref_type", "ref_id", "created_at" FROM `ai_credit_ledger`;--> statement-breakpoint
DROP TABLE `ai_credit_ledger`;--> statement-breakpoint
ALTER TABLE `__new_ai_credit_ledger` RENAME TO `ai_credit_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_credit_ledger_user_created_idx` ON `ai_credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_credit_ledger_reason_ref_unique` ON `ai_credit_ledger` (`reason`,`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `__new_credit_purchases` (
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
	`refunded_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_credit_purchases`("id", "user_id", "stripe_checkout_session_id", "stripe_payment_intent_id", "pack_id", "credits", "amount_total", "currency", "status", "created_at", "refunded_at") SELECT "id", "user_id", "stripe_checkout_session_id", "stripe_payment_intent_id", "pack_id", "credits", "amount_total", "currency", "status", "created_at", "refunded_at" FROM `credit_purchases`;--> statement-breakpoint
DROP TABLE `credit_purchases`;--> statement-breakpoint
ALTER TABLE `__new_credit_purchases` RENAME TO `credit_purchases`;--> statement-breakpoint
CREATE UNIQUE INDEX `credit_purchases_checkout_session_unique` ON `credit_purchases` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_payment_intent_idx` ON `credit_purchases` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `credit_purchases_user_created_idx` ON `credit_purchases` (`user_id`,`created_at`);