import type { DocEdit } from "@ankify/contracts";

/** Keeps only the fields the op uses: models often send every optional field,
 *  empty or not, and the edit schema is strict. */
export function docEditInput(
  op: DocEdit["op"],
  fields: { section?: string; markdown?: string; prompt?: string; answer?: string; key?: string },
) {
  const pick = (value?: string) => (value && value.trim() ? value : undefined);
  switch (op) {
    case "append_section":
    case "replace_section":
      return { op, section: pick(fields.section), markdown: fields.markdown ?? "" };
    case "add_card":
      return { op, prompt: pick(fields.prompt), answer: pick(fields.answer) };
    case "update_card": {
      const prompt = pick(fields.prompt);
      const answer = pick(fields.answer);
      return { op, key: pick(fields.key), ...(prompt ? { prompt } : {}), ...(answer ? { answer } : {}) };
    }
    case "remove_card":
      return { op, key: pick(fields.key) };
  }
}
