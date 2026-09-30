INSERT INTO mistake_records
  (id, user_id, problem_id, primary_category, secondary_tags, summary, next_step,
   source_type, submission_id, status, origin, request_id, confirmed_at, created_at, updated_at)
VALUES ('history-mistake', 'history-owner', 'history-problem', 'edge_case', '["duplicates"]',
   'Handle equal values at different indices', 'Check [3,3]', 'submission', 'history-failed',
   'confirmed', 'user', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1788444750000, 1788444750000, 1788444750000);
INSERT INTO ai_jobs
  (id, user_id, problem_id, kind, action, status, idempotency_key, input_envelope,
   provider, model, reasoning_mode, generation_language, attempt, run_after,
   error_code, queued_at, started_at, finished_at, created_at, updated_at)
VALUES ('history-ai-job', 'history-owner', 'history-problem', 'card', 'card_generate', 'failed',
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '{"v":1,"iv":"x","tag":"x","ciphertext":"x"}',
   'deepseek', 'deepseek-chat', 'fast', 'en', 3, 1788444750000,
   'provider_error', 1788444750000, 1788444750000, 1788444760000, 1788444750000, 1788444760000);
