DROP INDEX `ai_credit_ledger_reason_ref_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `ai_credit_ledger_reason_ref_bucket_unique` ON `ai_credit_ledger` (`reason`,`ref_type`,`ref_id`,`bucket`);