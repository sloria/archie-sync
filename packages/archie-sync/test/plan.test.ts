import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseFile } from "../src/core.ts";
import { planPull, planPush } from "../src/plan.ts";
import { docOf, parsedFile } from "./generate.ts";

const FILE_TEXT =
  '{\n  "greeting": "Hello",\n  "nested": {\n    "bye": "Bye"\n  }\n}\n';
const fileOf = (text = FILE_TEXT) => parsedFile("en", text);

const SAME: [string, string][] = [
  ["greeting", "Hello"],
  ["nested.bye", "Bye"],
];

describe("planPull", () => {
  test("reports a changed value and writes it in the file's formatting", () => {
    const plan = planPull({
      document: docOf([
        ["greeting", "Hola"],
        ["nested.bye", "Bye"],
      ]),
      files: [fileOf()],
    });
    assert.deepEqual(plan.changes[0].changes, [
      { key: "greeting", before: "Hello", after: "Hola" },
    ]);
    assert.equal(plan.writes[0].text, FILE_TEXT.replace("Hello", "Hola"));
  });

  test("an unusable file blocks the write without needing a tab", () => {
    const plan = planPull({
      document: docOf(SAME),
      files: [parseFile("en", '{"a": [1]}')],
    });
    assert.match(plan.errors.join("\n"), /not supported/);
    assert.deepEqual(plan.writes, []);
  });

  test("a file with no tab is an error", () => {
    const plan = planPull({ document: { tabs: [] }, files: [fileOf()] });
    assert.match(plan.errors.join("\n"), /missing tab "en"/);
  });
});

describe("planPush", () => {
  test("emits no requests when the doc already matches", () => {
    const plan = planPush({ document: docOf(SAME), files: [fileOf()] });
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.requests, []);
    assert.deepEqual(plan.changes[0].changes, []);
  });

  test("reports a key the doc has and the file doesn't as dropped", () => {
    const plan = planPush({
      document: docOf([...SAME, ["gone", "Removed"]]),
      files: [fileOf()],
    });
    const dropped = plan.changes[0].changes.find((c) => c.key === "gone");
    assert.deepEqual(dropped, { key: "gone", before: "Removed" });
  });

  test("targets the tab it was given", () => {
    const document = docOf([["greeting", "Stale"]], "tab-42");
    const plan = planPush({ document, files: [fileOf()] });
    for (const request of plan.requests) {
      const target =
        "deleteContentRange" in request
          ? request.deleteContentRange.range
          : request.insertText.location;
      assert.equal(target.tabId, "tab-42");
    }
  });
});
