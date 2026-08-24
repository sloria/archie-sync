#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs, styleText } from "node:util";
import pkg from "../package.json" with { type: "json" };
import {
  fileNameForTab,
  isUsable,
  type ParsedFile,
  parseFile,
  stringify,
  tabTitleForFile,
  type UnusableFile,
} from "./core.ts";
import { renderChanges } from "./diff.ts";
import {
  batchUpdate,
  CredentialsError,
  docsClient,
  fetchDoc,
} from "./gdocs.ts";
import { type PullPlan, type PushPlan, planPull, planPush } from "./plan.ts";

const USAGE = `Sync a Google Doc containing ArchieML with local JSON files.

  archie-sync pull  --dir <dir>            write the doc's values into the files
  archie-sync push  --dir <dir> [--yes]    replace the doc's tabs with the files
  archie-sync print --dir <dir> <tab>      print one tab as ArchieML

Options
  --dir <dir>       directory of JSON files; each file's base name is its tab
  --doc-id <id>     defaults to $DOC_ID
  --env <path>      env file to load
  -y, --yes         skip push's confirmation prompt
  -h, --help        show this help
  -v, --version     show the version

Credentials come from $GOOGLE_CREDENTIALS_BASE64, the base64 of a service account key.`;

const OPTIONS = {
  dir: { type: "string" },
  "doc-id": { type: "string" },
  env: { type: "string" },
  yes: { type: "boolean", short: "y", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

function loadEnvFile(path: string | undefined) {
  try {
    process.loadEnvFile(path ?? ".env");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    if (path || !missing) fail(String(error), 2);
  }
}

function readFiles(dir: string): (ParsedFile | UnusableFile)[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    fail(`Cannot read directory: ${dir}`, 2);
  }
  return names.flatMap((name) => {
    const title = tabTitleForFile(name);
    if (title === null) return [];
    return [parseFile(title, readFileSync(join(dir, name), "utf8"))];
  });
}

/** Prints the diff, or exits on errors. Returns whether anything changed. */
function report(plan: PullPlan | PushPlan) {
  if (plan.errors.length > 0) {
    console.error("Refusing to write:");
    for (const error of plan.errors) console.error(`  ${error}`);
    process.exit(1);
  }
  const rendered = renderChanges(plan.changes, {
    // Take advantage of the fact that styleText returns the input when color is unsupported or disabled
    color: styleText("red", "x") !== "x",
  });
  if (rendered) console.log(rendered);
  return plan.changes.some((tab) => tab.changes.length > 0);
}

async function confirm(question: string) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await readline.question(question);
  readline.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function pull(dir: string, id: string) {
  const files = readFiles(dir);
  const client = docsClient([
    "https://www.googleapis.com/auth/documents.readonly",
  ]);
  const document = await fetchDoc(client, id, {
    suggestionsViewMode: "PREVIEW_WITHOUT_SUGGESTIONS",
  });

  const plan = planPull({ document, files });
  const changed = report(plan);
  for (const { title, text } of plan.writes)
    writeFileSync(join(dir, fileNameForTab(title)), text);
  if (!changed) console.log("No changes. The files already match the doc.");
}

async function push(dir: string, id: string, yes: boolean) {
  const files = readFiles(dir);
  const client = docsClient(["https://www.googleapis.com/auth/documents"]);
  const document = await fetchDoc(client, id);

  const plan = planPush({ document, files });
  if (!report(plan)) {
    console.log("No changes. The doc already matches the files.");
    return;
  }
  if (!yes) {
    if (!process.stdin.isTTY)
      fail("Not a terminal. Pass --yes to overwrite the tabs above.", 2);
    const confirmed = await confirm(
      "\nOverwrite the tabs above? This discards their comments and pending suggestions. [y/N] ",
    );
    if (!confirmed) return console.log("Nothing written.");
  }

  await batchUpdate(client, id, plan.requests, document.revisionId);
  console.log("\nDone.");
}

function print(dir: string, title: string | undefined) {
  const files = readFiles(dir);
  const file = files.find((candidate) => candidate.title === title);
  if (!file)
    fail(
      `${title ? `Unknown tab "${title}".` : "Name a tab."} Expected one of: ${files.map((f) => f.title).join(", ")}`,
      2,
    );
  if (!isUsable(file)) fail(file.errors.join("\n"));
  process.stdout.write(stringify(file.tree));
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: OPTIONS,
});

const [command, argument] = positionals;
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}
if (values.help || !command) {
  console.log(USAGE);
  process.exit(command ? 0 : 2);
}
if (!values.dir) fail(`--dir is required.\n\n${USAGE}`, 2);
loadEnvFile(values.env);

const docId = values["doc-id"] ?? process.env.DOC_ID;

try {
  if (command === "print") print(values.dir, argument);
  else if (command !== "pull" && command !== "push")
    fail(`Unknown command "${command}".\n\n${USAGE}`, 2);
  else if (!docId) fail("No doc id. Pass --doc-id or set DOC_ID.", 2);
  else if (command === "pull") await pull(values.dir, docId);
  else await push(values.dir, docId, values.yes);
} catch (error) {
  fail(error instanceof CredentialsError ? error.message : String(error));
}
