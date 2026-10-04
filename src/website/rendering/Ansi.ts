import type { CSSProperties } from "react";

export namespace Ansi {
  type Segment = {
    text: string;
    style?: CSSProperties;
  };

  /** A line cut into runs that look alike; codes other than colors and text styles (cursor moves, links) are dropped */
  export function parse(line: string): Segment[] {
    if (!line.includes("\x1b")) return [{ text: line }];
    const segments: Segment[] = [];
    let state: Internal.State = {};
    let last = 0;
    const push = (text: string) => {
      if (!text) return;
      const style = Internal.style(state);
      const previous = segments.at(-1);
      if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) {
        previous.text += text;
      } else {
        segments.push(style ? { text, style } : { text });
      }
    };
    for (const match of line.matchAll(Internal.ESCAPE)) {
      push(line.slice(last, match.index));
      const [, params, final] = match;
      if (final === "m") state = Internal.apply(state, params ?? "");
      last = match.index + match[0].length;
    }
    push(line.slice(last));
    return segments;
  }
}

namespace Internal {
  // a CSI sequence (params, final byte), an OSC sequence such as a hyperlink, or a two-byte escape
  export const ESCAPE = /\x1b(?:\[([0-9;:?]*)([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;

  // the 16 basic colors, lifted a little so that "black" still shows on a black page
  const PALETTE = [
    "#6b6b6b", "#ff6b6b", "#4cc38a", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#d0d0d0",
    "#8a8a8a", "#ff8f8f", "#7ee2a8", "#f2d58f", "#8cc4ff", "#dba4f0", "#86d9e2", "#ffffff",
  ];

  export type State = {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    inverse?: boolean;
  };

  export function apply(state: State, params: string): State {
    const codes = params === "" ? [0] : params.split(/[;:]/).map((code) => Number(code || 0));
    let next = { ...state };
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) next = {};
      else if (code === 1) next.bold = true;
      else if (code === 2) next.dim = true;
      else if (code === 3) next.italic = true;
      else if (code === 4) next.underline = true;
      else if (code === 7) next.inverse = true;
      else if (code === 9) next.strike = true;
      else if (code === 21 || code === 22) next.bold = next.dim = undefined;
      else if (code === 23) next.italic = undefined;
      else if (code === 24) next.underline = undefined;
      else if (code === 27) next.inverse = undefined;
      else if (code === 29) next.strike = undefined;
      else if (code >= 30 && code <= 37) next.fg = PALETTE[code - 30];
      else if (code >= 90 && code <= 97) next.fg = PALETTE[code - 90 + 8];
      else if (code === 39) next.fg = undefined;
      else if (code >= 40 && code <= 47) next.bg = PALETTE[code - 40];
      else if (code >= 100 && code <= 107) next.bg = PALETTE[code - 100 + 8];
      else if (code === 49) next.bg = undefined;
      else if (code === 38 || code === 48) {
        const [color, used] = extended(codes, i + 1);
        if (code === 38) next.fg = color;
        else next.bg = color;
        i += used;
      }
    }
    return next;
  }

  /** `5;n` from the 256-color table or `2;r;g;b`; returns the color and how many codes it took */
  function extended(codes: number[], from: number): [string | undefined, number] {
    if (codes[from] === 5) return [color256(codes[from + 1] ?? 0), 2];
    if (codes[from] === 2) {
      const [r = 0, g = 0, b = 0] = codes.slice(from + 1, from + 4);
      return [`rgb(${r}, ${g}, ${b})`, 4];
    }
    return [undefined, 0];
  }

  function color256(n: number): string {
    if (n < 16) return PALETTE[n];
    if (n < 232) {
      const level = (step: number) => (step === 0 ? 0 : 55 + step * 40);
      const index = n - 16;
      return `rgb(${level(Math.floor(index / 36))}, ${level(Math.floor(index / 6) % 6)}, ${level(index % 6)})`;
    }
    const gray = 8 + (n - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }

  export function style(state: State): CSSProperties | undefined {
    const fg = state.inverse ? (state.bg ?? "var(--color-c-surface)") : state.fg;
    const bg = state.inverse ? (state.fg ?? "var(--color-c-log)") : state.bg;
    const decoration = [state.underline && "underline", state.strike && "line-through"].filter(Boolean).join(" ");
    const css: CSSProperties = {
      ...(fg && { color: fg }),
      ...(bg && { backgroundColor: bg }),
      ...(state.bold && { fontWeight: 700 }),
      ...(state.dim && { opacity: 0.6 }),
      ...(state.italic && { fontStyle: "italic" }),
      ...(decoration && { textDecoration: decoration }),
    };
    return Object.keys(css).length > 0 ? css : undefined;
  }
}
