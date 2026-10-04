import { describe, expect, it } from "bun:test";
import { Ansi } from "./Ansi";

describe("Ansi", () => {
  const ESC = "\x1b";

  it("should leave a line without escape codes as it is", () => {
    expect(Ansi.parse("Server started on :3000")).toEqual([{ text: "Server started on :3000" }]);
  });

  it("should turn bold on and off again", () => {
    expect(Ansi.parse(`${ESC}[1mServer BRRRRR ${ESC}[0m`)).toEqual([{ text: "Server BRRRRR ", style: { fontWeight: 700 } }]);
    expect(Ansi.parse(`a ${ESC}[1mb${ESC}[m c`)).toEqual([{ text: "a " }, { text: "b", style: { fontWeight: 700 } }, { text: " c" }]);
  });

  it("should keep a style until it is reset, and combine it with the next", () => {
    expect(Ansi.parse(`${ESC}[32mok ${ESC}[1mBOLD${ESC}[22m ok${ESC}[39m plain`)).toEqual([
      { text: "ok ", style: { color: "#4cc38a" } },
      { text: "BOLD", style: { color: "#4cc38a", fontWeight: 700 } },
      { text: " ok", style: { color: "#4cc38a" } },
      { text: " plain" },
    ]);
  });

  it("should read the 16, 256 and true color forms, for text and background", () => {
    const style = (codes: string) => Ansi.parse(`${ESC}[${codes}mx`)[0].style;
    expect(style("31")).toEqual({ color: "#ff6b6b" });
    expect(style("91")).toEqual({ color: "#ff8f8f" });
    expect(style("44")).toEqual({ backgroundColor: "#61afef" });
    expect(style("38;5;196")).toEqual({ color: "rgb(255, 0, 0)" });
    expect(style("38;5;244")).toEqual({ color: "rgb(128, 128, 128)" });
    expect(style("48;2;10;20;30")).toEqual({ backgroundColor: "rgb(10, 20, 30)" });
    expect(style("38:2:10:20:30")).toEqual({ color: "rgb(10, 20, 30)" });
    expect(style("1;4;38;5;2;3")).toEqual({ color: "#4cc38a", fontWeight: 700, fontStyle: "italic", textDecoration: "underline" });
  });

  it("should swap text and background when inverted", () => {
    expect(Ansi.parse(`${ESC}[7mx`)[0].style).toEqual({ color: "var(--color-c-surface)", backgroundColor: "var(--color-c-log)" });
    expect(Ansi.parse(`${ESC}[31;7mx`)[0].style).toEqual({ color: "var(--color-c-surface)", backgroundColor: "#ff6b6b" });
  });

  it("should drop codes that are not colors or styles, and keep the text of a link", () => {
    expect(Ansi.parse(`${ESC}[2K${ESC}[1Gprogress 40%`)).toEqual([{ text: "progress 40%" }]);
    expect(Ansi.parse(`see ${ESC}]8;;https://example.com${ESC}\\the docs${ESC}]8;;${ESC}\\ now`)).toEqual([{ text: "see the docs now" }]);
    expect(Ansi.parse(`bell ${ESC}]0;title\x07done`)).toEqual([{ text: "bell done" }]);
  });
});
