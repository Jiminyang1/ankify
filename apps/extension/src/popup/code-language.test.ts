import { describe, expect, it } from "vitest";
import { resolveCodeLanguage, splitCodeFences } from "./code-language";

describe("resolveCodeLanguage", () => {
  it("knows LeetCode's editor names and common fence names", () => {
    expect(resolveCodeLanguage("python3")).toBe("python");
    expect(resolveCodeLanguage("C++")).toBe("cpp");
    expect(resolveCodeLanguage(" golang ")).toBe("go");
    expect(resolveCodeLanguage("mysql")).toBe("sql");
  });

  it("leaves anything else plain", () => {
    expect(resolveCodeLanguage("brainfuck")).toBeNull();
    expect(resolveCodeLanguage("constructor")).toBeNull();
    expect(resolveCodeLanguage(null)).toBeNull();
    expect(resolveCodeLanguage("")).toBeNull();
  });
});

describe("splitCodeFences", () => {
  it("keeps a message without fences as it is", () => {
    expect(splitCodeFences("why does *this* fail?\n  second line")).toEqual([
      { kind: "text", text: "why does *this* fail?\n  second line" },
    ]);
  });

  it("splits text and code around a fence", () => {
    expect(splitCodeFences("look:\n```python\nx = 1\ny = 2\n```\nwhy?")).toEqual([
      { kind: "text", text: "look:" },
      { kind: "code", code: "x = 1\ny = 2", language: "python" },
      { kind: "text", text: "why?" },
    ]);
  });

  it("handles a message that is only a fence, with no language", () => {
    expect(splitCodeFences("```\nx = 1\n```")).toEqual([{ kind: "code", code: "x = 1", language: null }]);
  });

  it("runs an unclosed fence to the end", () => {
    expect(splitCodeFences("```js\nlet a;\nlet b;")).toEqual([
      { kind: "code", code: "let a;\nlet b;", language: "js" },
    ]);
  });

  it("handles several fences", () => {
    expect(splitCodeFences("```py\na\n```\nand\n```go\nb\n```").map((part) => part.kind)).toEqual([
      "code",
      "text",
      "code",
    ]);
  });

  it("doesn't treat inline backticks as a fence", () => {
    expect(splitCodeFences("use ```x``` here")).toEqual([{ kind: "text", text: "use ```x``` here" }]);
  });
});
