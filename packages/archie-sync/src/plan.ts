import {
  type DocumentTab,
  fileStrings,
  flattenTree,
  isUsable,
  missingTabError,
  type ParsedFile,
  type PushRequest,
  parseTab,
  stringify,
  stringifyFile,
  type Tab,
  type TabbedDocument,
  tabsByTitle,
  type UnusableFile,
  validateTab,
} from "./core.ts";

export interface Change {
  key: string;
  before?: string;
  after?: string;
}

export interface TabChanges {
  title: string;
  changes: Change[];
}

export interface Write {
  title: string;
  text: string;
}

export interface PullPlan {
  errors: string[];
  writes: Write[];
  changes: TabChanges[];
}

export interface PushPlan {
  errors: string[];
  requests: PushRequest[];
  changes: TabChanges[];
}

export interface PlanInput {
  document: TabbedDocument;
  files: (ParsedFile | UnusableFile)[];
}

// Body characters are numbered from 1 and endIndex is exclusive, so the last
// element's endIndex is one past the whole body.
const bodyEnd = (documentTab: DocumentTab) =>
  documentTab.body?.content?.at(-1)?.endIndex ?? 1;

function pair({ document, files }: PlanInput) {
  const tabs = tabsByTitle(document);
  const errors = files.flatMap((file) => file.errors);
  const paired: { file: ParsedFile; tab: Tab }[] = [];

  for (const file of files) {
    if (!isUsable(file)) continue;
    const missing = missingTabError(tabs, file.title);
    if (missing) errors.push(missing);
    else paired.push({ file, tab: tabs.get(file.title) as Tab });
  }
  return { errors, paired };
}

const changesBetween = (
  before: Map<string, string>,
  after: Map<string, string>,
): Change[] => [
  ...[...after]
    .filter(([key, value]) => before.get(key) !== value)
    .map(([key, value]) => ({ key, before: before.get(key), after: value })),
  ...[...before.keys()]
    .filter((key) => !after.has(key))
    .map((key) => ({ key, before: before.get(key) })),
];

/**
 * Works out the text each file would be written with. Any error means no writes
 * at all: a half-applied pull would leave the files disagreeing with the doc
 * with nothing to show for it.
 *
 * @param input the fetched document and the parsed files, paired by tab title.
 * @returns the writes to apply and the per-tab changes to show.
 */
export function planPull(input: PlanInput): PullPlan {
  const { errors, paired } = pair(input);
  const writes: Write[] = [];
  const changes: TabChanges[] = [];

  for (const { file, tab } of paired) {
    const flat = flattenTree(
      parseTab(tab.documentTab as NonNullable<Tab["documentTab"]>),
    );
    const strings = fileStrings(file);
    errors.push(...validateTab(file.title, strings, flat));
    writes.push({ title: file.title, text: stringifyFile(file, flat) });
    changes.push({ title: file.title, changes: changesBetween(strings, flat) });
  }

  if (errors.length > 0) return { errors, writes: [], changes: [] };
  return { errors, writes, changes };
}

/**
 * Builds the batchUpdate requests that replace each tab with its file.
 *
 * @param input the fetched document and the parsed files, paired by tab title.
 * @returns the requests to send and the per-tab changes to show.
 */
export function planPush(input: PlanInput): PushPlan {
  const { errors, paired } = pair(input);
  const requests: PushRequest[] = [];
  const changes: TabChanges[] = [];

  for (const { file, tab } of paired) {
    const documentTab = tab.documentTab as NonNullable<Tab["documentTab"]>;
    const strings = fileStrings(file);
    const tabChanges = changesBetween(
      flattenTree(parseTab(documentTab)),
      strings,
    );
    changes.push({ title: file.title, changes: tabChanges });
    if (tabChanges.length === 0) continue;

    const tabId = tab.tabProperties?.tabId;
    const end = bodyEnd(documentTab);
    if (end > 2)
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: end - 1, tabId },
        },
      });
    requests.push({
      insertText: {
        text: stringify(file.tree).replace(/\n$/, ""),
        location: { index: 1, tabId },
      },
    });
  }

  if (errors.length > 0) return { errors, requests: [], changes: [] };
  return { errors, requests, changes };
}
