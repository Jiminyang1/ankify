-- The Cards doc folds into Notes (docs/product-main-line.md, "Docs: three to
-- two"). Each problem with a non-blank Cards doc gets it appended to Notes,
-- after a blank line, under a "## Cards" heading. Its "## prompt" headings move
-- one level down to "###", so the cards stay one Notes section instead of
-- becoming sections of their own (a "## " line inside a code block moves too).
-- The Cards doc itself is left as it is: older extension builds still show it.
UPDATE `problems`
SET
  `notes` = coalesce(nullif(rtrim(`notes`, ' ' || char(9) || char(10) || char(13)), '') || char(10) || char(10), '')
    || '## Cards' || char(10)
    || substr(
      replace(
        char(10) || rtrim(ltrim(`cards_md`, char(10) || char(13)), ' ' || char(9) || char(10) || char(13)),
        char(10) || '## ',
        char(10) || '### '
      ),
      2
    )
    || char(10),
  `notes_version` = `notes_version` + 1
WHERE trim(coalesce(`cards_md`, ''), ' ' || char(9) || char(10) || char(13)) <> '';
