import { diff, styleText } from "node:util";
import type { Change, TabChanges } from "./plan.ts";

export interface RenderOptions {
  color?: boolean;
}

const tokenize = (value: string) => value.split(/(\s+)/).filter(Boolean);

const REMOVED = 1;
const ADDED = -1;

const SIDES = {
  [REMOVED]: { sign: "-", fg: "red", span: ["red", "bgRed", "black"] },
  [ADDED]: { sign: "+", fg: "green", span: ["green", "bgGreen", "black"] },
} as const;

/**
 * Diffs two values by word, merging runs of same-direction tokens so a painted
 * span has no seams.
 */
function spans(before: string, after: string) {
  const merged: [number, string][] = [];
  const from = tokenize(before);
  const to = tokenize(after);
  // util.diff throws on two empty inputs, which two empty values would give.
  if (from.length === 0 && to.length === 0) return merged;

  for (const [direction, token] of diff(from, to)) {
    const previous = merged.at(-1);
    if (previous && previous[0] === direction) previous[1] += token;
    else merged.push([direction, token]);
  }
  return merged;
}

const paint = (
  color: boolean,
  style: Parameters<typeof styleText>[0],
  text: string,
) => (color ? styleText(style, text, { validateStream: false }) : text);

function line(
  merged: [number, string][],
  keep: typeof REMOVED | typeof ADDED,
  color: boolean,
) {
  const { sign, fg, span } = SIDES[keep];
  const body = merged
    .filter(([direction]) => direction === 0 || direction === keep)
    .map(([direction, text]) =>
      direction === 0 ? text : paint(color, span, text),
    )
    .join("");
  return `  ${paint(color, fg, sign)} ${body}`;
}

export function renderChange(
  change: Change,
  { color = false }: RenderOptions = {},
) {
  const merged = spans(change.before ?? "", change.after ?? "");
  const lines = [paint(color, "bold", change.key)];
  if (change.before !== undefined) lines.push(line(merged, REMOVED, color));
  if (change.after !== undefined) lines.push(line(merged, ADDED, color));
  return lines.join("\n");
}

export function renderChanges(
  tabs: TabChanges[],
  options: RenderOptions = {},
): string {
  const blocks: string[] = [];
  for (const { title, changes } of tabs) {
    if (changes.length === 0) continue;
    blocks.push(
      `${title}: ${changes.length} changed`,
      ...changes.map((change) => renderChange(change, options)),
    );
  }
  return blocks.join("\n\n");
}
