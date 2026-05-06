DELETE FROM `quiz_sessions`
WHERE EXISTS (
  SELECT 1
  FROM json_each(`quiz_sessions`.`items_json`) AS item
  WHERE json_type(item.value, '$.scope') IS NULL
    OR json_extract(item.value, '$.scope') NOT IN (
      'approach',
      'invariant',
      'edge_case',
      'complexity',
      'implementation',
      'mistake_review'
    )
);
