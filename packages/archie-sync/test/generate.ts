import fc from "fast-check";
import {
  isUsable,
  type ParsedFile,
  type PushRequest,
  parseFile,
  stringify,
  type Tree,
} from "../src/core.ts";

/** Parses a locale file, throwing on text a test expected to be valid. */
export function parsedFile(title: string, text: string): ParsedFile {
  const file = parseFile(title, text);
  if (!isUsable(file)) throw new Error(`${title}: ${file.errors.join(", ")}`);
  return file;
}

// Values chosen to be hostile in the ways ArchieML is fragile: lines that look
// like keys, commands, scopes, arrays, bullets, and already-escaped lines.
const LINES = [
  "plain text",
  "key: not a key",
  ":end",
  ":skip",
  ":ignore",
  "{scope}",
  "[array]",
  "* bullet",
  "\\already escaped",
  "  leading",
  "trailing  ",
  "",
  "café ñ 😀",
  "A & B <x>",
  "[link](https://example.com)",
  "**bold**",
];

const line = fc.oneof(
  { arbitrary: fc.constantFrom(...LINES), weight: 4 },
  { arbitrary: fc.string({ maxLength: 8 }), weight: 1 },
);

/** Generates a value of one to three lines; multi-line ones reach the :end form. */
export const value = fc
  .array(line, { minLength: 1, maxLength: 3 })
  .map((lines) => lines.join("\n"));

const segment = fc.oneof(
  fc.constantFrom("intro", "nav", "lede", "a", "maxMembers", "step2", "x-y_z"),
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,7}$/),
);

/** Generates a map of dotted key paths to values, so nesting is exercised. */
export const strings = fc
  .array(fc.tuple(fc.array(segment, { minLength: 1, maxLength: 3 }), value), {
    minLength: 1,
    maxLength: 12,
  })
  .map((pairs) => {
    const map = new Map();
    for (const [path, text] of pairs) map.set(path.join("."), text);
    return map;
  })
  // A path that is also a prefix of another path can't be both a string and an
  // object, which is a JSON shape the tool rejects rather than a doc concern.
  .map((map) => {
    const kept = new Map();
    for (const [key, text] of map) {
      const clashes = [...map.keys()].some(
        (other) => other !== key && other.startsWith(`${key}.`),
      );
      if (!clashes) kept.set(key, text);
    }
    return kept;
  })
  .filter((map) => map.size > 0);

export function treeOf(map: Map<string, string>): Tree {
  const tree: Tree = {};
  for (const [key, text] of map) {
    const path = key.split(".");
    let node = tree;
    for (const segment of path.slice(0, -1)) {
      node[segment] ??= {};
      node = node[segment] as Tree;
    }
    node[path.at(-1)!] = text;
  }
  return tree;
}

const runsOf = (text: string) =>
  text.length === 0
    ? [{ textRun: { content: "" } }]
    : [...text].map((char) => ({ textRun: { content: char } }));

/**
 * Serializes ArchieML text as a Docs API tab, fragmented the way a real
 * document is. None of that fragmentation may be observable in the result.
 */
export function asGdocTab(text: string, { fragment = true } = {}) {
  const content = text.split("\n").map((lineText: string) => ({
    paragraph: {
      elements: [
        ...(fragment ? runsOf(lineText) : [{ textRun: { content: lineText } }]),
        { textRun: { content: "\n" } },
        {
          textRun: {
            content: "GHOST",
            suggestedInsertionIds: ["pending"],
          },
        },
      ],
    },
  }));
  return { body: { content } };
}

/**
 * Serializes ArchieML text as a tab carrying the index metadata the Docs API
 * reports: every character is addressable, the body starts at index 1, and each
 * element's endIndex is one past its last character. planPush's range
 * arithmetic is written against this.
 */
export function asIndexedTab(text: string, tabId = "t1") {
  let index = 1;
  // The final newline terminates the last paragraph; it is not one of its own.
  const content = text
    .replace(/\n$/, "")
    .split("\n")
    .map((lineText) => {
      const startIndex = index;
      index += lineText.length + 1;
      return {
        startIndex,
        endIndex: index,
        paragraph: {
          elements: [{ textRun: { content: `${lineText}\n` } }],
        },
      };
    });
  return {
    tabProperties: { title: "en", tabId },
    documentTab: { body: { content } },
  };
}

/**
 * Applies batchUpdate requests to a tab's text, written from the Docs API
 * reference rather than from plan.ts — a shared implementation would only
 * prove the two agree with each other.
 */
export function applyRequests(text: string, requests: PushRequest[]) {
  let result = text;
  for (const request of requests) {
    if ("deleteContentRange" in request) {
      const { startIndex, endIndex } = request.deleteContentRange.range;
      result = result.slice(0, startIndex - 1) + result.slice(endIndex - 1);
    } else if ("insertText" in request) {
      const { text: inserted, location } = request.insertText;
      result =
        result.slice(0, location.index - 1) +
        inserted +
        result.slice(location.index - 1);
    } else {
      throw new Error(`unmodelled request: ${Object.keys(request)}`);
    }
  }
  return result;
}

export const ESC = String.fromCharCode(27);
export const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
export const stripAnsi = (text: string) => text.replace(ANSI, "");

/** Builds a one-tab document, the shape both planners take. */
export const docOf = (strings: Iterable<[string, string]>, tabId?: string) => ({
  revisionId: "rev1",
  tabs: [asIndexedTab(stringify(treeOf(new Map(strings))), tabId)],
});

/** Reports whether stringify can represent these strings at all. */
export function stringifiesCleanly(map: Map<string, string>) {
  try {
    stringify(treeOf(map));
    return true;
  } catch {
    return false;
  }
}

export const config = {
  numRuns: Number(process.env.FUZZ_CASES ?? 200),
  ...(process.env.FUZZ_SEED ? { seed: Number(process.env.FUZZ_SEED) } : {}),
};

export const check = (property: fc.IRawProperty<unknown>) =>
  fc.assert(property, config);
