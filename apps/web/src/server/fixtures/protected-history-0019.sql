-- Synthetic protected history. This fixture deliberately uses raw SQL so
-- later schema changes cannot silently change the baseline values.
INSERT INTO user (id, name, email, created_at, updated_at)
VALUES ('history-owner', 'History Owner', 'history@example.test', 1700000000000, 1700000000000),
       ('history-other', 'History Other', 'history-other@example.test', 1700000000000, 1700000000000);
INSERT INTO problems
  (id, user_id, leetcode_slug, leetcode_id, title, difficulty, url, description_md,
   topic_tags, similar_slugs, notes, fsrs_due, fsrs_stability, fsrs_difficulty,
   fsrs_elapsed_days, fsrs_scheduled_days, fsrs_learning_steps, fsrs_reps, fsrs_lapses,
   fsrs_state, fsrs_last_review, archived_at, created_at, updated_at)
VALUES
  ('history-problem', 'history-owner', 'two-sum', 1, 'Two Sum', 'Easy',
   'https://leetcode.com/problems/two-sum/', '<p>Original statement</p>', '["Array"]', '["3sum"]',
   'Preserve **notes**, Unicode: 边界, and `code`.', 1790000000000, 18.125, 4.875,
   7.25, 18, 0, 8, 2, 'review', 1788444800000, NULL, 1700000000000, 1788444800000),
  ('history-archived', 'history-owner', '3sum', 15, '3Sum', 'Medium',
   'https://leetcode.com/problems/3sum/', NULL, '[]', '[]', 'Archived notes',
   NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 'new', NULL, 1788444800000, 1700000000000, 1788444800000),
  ('history-other-problem', 'history-other', 'two-sum', 1, 'Two Sum', 'Easy',
   'https://leetcode.com/problems/two-sum/', NULL, '[]', '[]', 'Private other notes',
   NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 'new', NULL, NULL, 1700000000000, 1700000000000);
INSERT INTO submissions
  (id, user_id, problem_id, leetcode_submission_id, language, code, status,
   failed_testcase, expected_output, actual_output, submitted_at)
VALUES
  ('history-failed', 'history-owner', 'history-problem', '71001', 'python3', 'return []',
   'Wrong Answer', '[3,3]', '[0,1]', '[]', 1788444000000),
  ('history-accepted', 'history-owner', 'history-problem', '71002', 'python3', 'return [0,1]',
   'Accepted', NULL, NULL, NULL, 1788444700000),
  ('history-other-submission', 'history-other', 'history-other-problem', '71001', 'python3', 'private code',
   'Runtime Error', NULL, NULL, NULL, 1788444000000);
INSERT INTO review_events
  (id, user_id, problem_id, event_type, fsrs_rating, request_id, undone_at,
   fsrs_stability_snap, fsrs_difficulty_snap, fsrs_retrievability_snap, metadata, occurred_at)
VALUES
  ('history-review', 'history-owner', 'history-problem', 'self_recall_rated', 3,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 18.125, 4.875, 0.87,
   '{"undo":{"due":"2026-09-01T00:00:00.000Z","stability":12.5,"difficulty":5,"elapsedDays":7,"scheduledDays":12,"learningSteps":0,"reps":7,"lapses":2,"state":"review","lastReview":"2026-08-20T00:00:00.000Z"}}', 1788444800000),
  ('history-undone', 'history-owner', 'history-problem', 'self_recall_rated', 1,
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1788444820000, 1.5, 6.5, 0.86,
   '{"undo":{"reps":8}}', 1788444810000);
