import archieml from "archieml";
import gdocToText, { type GoogleDocument } from "gdoc-to-text";

type Element = NonNullable<
  NonNullable<GoogleDocument["body"]>["content"]
>[number] & { endIndex?: number };

export interface DocumentTab extends GoogleDocument {
  body?: { content?: Element[] };
}

export interface Tab {
  tabProperties?: { title?: string; tabId?: string };
  documentTab?: DocumentTab;
  childTabs?: Tab[];
}

export interface TabbedDocument {
  tabs?: Tab[];
  revisionId?: string;
}

interface DeleteContentRangeRequest {
  deleteContentRange: {
    range: {
      startIndex: number;
      endIndex: number;
      tabId?: string;
    };
  };
}

interface InsertTextRequest {
  insertText: {
    text: string;
    location: {
      index: number;
      tabId?: string;
    };
  };
}

export type PushRequest = DeleteContentRangeRequest | InsertTextRequest;

export type Tree = { [key: string]: string | Tree };

const flatten = (value: string | Tree, prefix = ""): [string, string][] =>
  typeof value === "string"
    ? [[prefix, value]]
    : Object.entries(value).flatMap(([k, v]) =>
        flatten(v, prefix ? `${prefix}.${k}` : k),
      );

const describe = (value: unknown) =>
  Array.isArray(value) ? "array" : value === null ? "null" : typeof value;

export function treeErrors(tree: unknown) {
  const errors: string[] = [];
  const seen = new Map<string, string>();

  const walk = (node: unknown, prefix: string) => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      errors.push(`${prefix}: ${describe(node)} values are not supported`);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value !== "string") walk(value, path);
      else if (seen.has(path))
        errors.push(
          `${path}: "${seen.get(path)}" and "${key}" reach the same key`,
        );
      else seen.set(path, key);
    }
  };

  walk(tree, "");
  return errors;
}

// When loading, archieml strips the leading backslash from every continuation line,
// so need to escape it when writing values back out.
const escapeLine = (line: string) => `\\${line}`;

function stringifyValue(key: string, value: string) {
  if (!value.includes("\n")) return [`${key}: ${value}`];
  const [first, ...rest] = value.split("\n");
  return [`${key}: ${first}`, ...rest.map(escapeLine), ":end"];
}

/** Flattens a tree to the `key.path` space tabs and files are compared in. */
export const flattenTree = (tree: Tree) => new Map(flatten(tree));

export const parse = (text: string) => archieml.load(text) as Tree;

export const parseTab = (documentTab: GoogleDocument) =>
  parse(gdocToText(documentTab));

/**
 * Renders a tree as one tab's ArchieML text, in the tree's own key order so the
 * file's ordering is what the collaborator reads top to bottom.
 *
 * @throws if the tree holds a non-string leaf, or if the text wouldn't parse
 * back to the same values.
 */
export function stringify(tree: Tree) {
  const shape = treeErrors(tree);
  if (shape.length > 0) throw new Error(shape.join("\n"));

  const strings = flattenTree(tree);
  const lines: string[] = [];
  for (const [key, value] of strings) {
    if (lines.length > 0) lines.push("");
    lines.push(...stringifyValue(key, value));
  }

  const text = `${lines.join("\n")}\n`;
  const roundTrip = flattenTree(parse(text));
  const broken = [...strings].filter(([k, v]) => roundTrip.get(k) !== v);
  const extra = [...roundTrip.keys()].filter((k) => !strings.has(k));
  if (broken.length > 0 || extra.length > 0) {
    throw new Error(
      `Some values cannot be represented in ArchieML:\n${[
        ...broken.map(([k]) => `  changed: ${k}`),
        ...extra.map((k) => `  extra: ${k}`),
      ].join("\n")}`,
    );
  }
  return text;
}

/**
 * Indexes a document's tabs, child tabs included, by title.
 *
 * @param document a documents.get response with includeTabsContent=true.
 */
export function tabsByTitle(document: TabbedDocument) {
  const tabs = new Map<string | undefined, Tab>();
  const collect = (tab: Tab) => {
    tabs.set(tab.tabProperties?.title, tab);
    for (const child of tab.childTabs ?? []) collect(child);
  };
  for (const tab of document.tabs ?? []) collect(tab);
  return tabs;
}

export const missingTabError = (
  tabs: Map<string | undefined, Tab>,
  title: string,
) =>
  tabs.get(title)?.documentTab
    ? null
    : `missing tab "${title}". Found: ${[...tabs.keys()].join(", ") || "none"}`;

/**
 * Reports the keys a tab and its file disagree about. A pull rebuilds each
 * file from its current values, so a key the tab has lost would keep the old
 * value and show up as no diff at all: the edit dropped with nothing to review.
 */
export function validateTab(
  title: string,
  fileStrings: Map<string, string>,
  flat: Map<string, string>,
) {
  const errors: string[] = [];
  const at = (key: string) => `[${title}] ${key}`;
  for (const key of fileStrings.keys()) {
    if (!flat.has(key))
      errors.push(
        `${at(key)}: missing, so the line was deleted or its key edited`,
      );
  }
  for (const key of flat.keys()) {
    if (!fileStrings.has(key))
      errors.push(
        `${at(key)}: unknown, so it was renamed in code or added by hand`,
      );
  }
  return errors;
}

export const fileNameForTab = (title: string, extension = "json") =>
  `${title}.${extension}`;

/**
 * Returns the tab title a file name belongs to, or null when the file isn't one
 * this tool syncs.
 */
export const tabTitleForFile = (fileName: string, extension = "json") =>
  fileName.endsWith(`.${extension}`)
    ? fileName.slice(0, -(extension.length + 1))
    : null;

export interface UnusableFile {
  title: string;
  errors: string[];
}

export interface ParsedFile {
  title: string;
  tree: Tree;
  /** Detected from the file, reused on write so diffs stay minimal. */
  indent: string;
  trailingNewline: boolean;
  errors: never[];
}

export const isUsable = (file: ParsedFile | UnusableFile): file is ParsedFile =>
  file.errors.length === 0;

export const fileStrings = (file: ParsedFile) => flattenTree(file.tree);

const detectIndent = (text: string) => text.match(/\n([ \t]+)"/)?.[1] ?? "  ";

export function parseFile(
  title: string,
  text: string,
): ParsedFile | UnusableFile {
  let tree: unknown;
  try {
    tree = JSON.parse(text);
  } catch (error) {
    return { title, errors: [`[${title}] invalid JSON: ${error}`] };
  }

  const errors = treeErrors(tree).map((message) => `[${title}] ${message}`);
  if (errors.length > 0) return { title, errors };

  return {
    title,
    tree: tree as Tree,
    indent: detectIndent(text),
    trailingNewline: text.endsWith("\n"),
    errors: [],
  };
}

export function stringifyFile(file: ParsedFile, flat: Map<string, string>) {
  const json = JSON.stringify(
    replaceValues(file.tree, flat),
    null,
    file.indent,
  );
  return file.trailingNewline ? `${json}\n` : json;
}

/**
 * Rebuilds a tree with the pulled values, keeping the current tree's exact key
 * order and nesting so diffs stay reviewable.
 */
export function replaceValues(
  current: string | Tree,
  flat: Map<string, string>,
  path = "",
): string | Tree {
  if (typeof current === "string") return flat.get(path) ?? current;
  return Object.fromEntries(
    Object.entries(current).map(([k, v]) => [
      k,
      replaceValues(v, flat, path ? `${path}.${k}` : k),
    ]),
  );
}
