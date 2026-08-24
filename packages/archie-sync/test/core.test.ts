import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  fileStrings,
  parseFile,
  replaceValues,
  stringify,
  stringifyFile,
  tabsByTitle,
  treeErrors,
  validateTab,
} from "../src/core.ts";
import { parsedFile } from "./generate.ts";

const strings = new Map([
  ["intro.lede", "Welcome to the site."],
  ["maxMembers", "A few members."],
  ["plain", "A plain label"],
]);

describe("stringify", () => {
  test("throws rather than emitting text that parses back differently", () => {
    // A key ArchieML claims for itself: the escaping can't protect the value.
    assert.throws(() => stringify({ ":end": "x" }), /cannot be represented/);
  });

  test("rejects a non-string leaf", () => {
    assert.throws(
      // @ts-expect-error the shape a caller-built tree can get wrong
      () => stringify({ count: 2 }),
      /number values are not supported/,
    );
  });
});

describe("validateTab", () => {
  test("reports a deleted line as a missing key", () => {
    const flat = new Map(strings);
    flat.delete("plain");
    const errors = validateTab("en", strings, flat);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /plain/);
    assert.match(errors[0], /missing/);
  });

  test("reports a renamed key as missing plus unknown", () => {
    const flat = new Map(strings);
    flat.delete("plain");
    flat.set("plane", "A plain label");
    const errors = validateTab("en", strings, flat);
    assert.equal(errors.length, 2);
    assert.match(errors.join("\n"), /plain.*missing/);
    assert.match(errors.join("\n"), /plane.*unknown/);
  });

  test("names the tab in every error", () => {
    const flat = new Map(strings);
    flat.delete("plain");
    assert.match(validateTab("es", strings, flat)[0], /^\[es\]/);
  });
});

describe("treeErrors", () => {
  for (const [label, tree] of [
    ["array", { items: ["a", "b"] }],
    ["number", { count: 2 }],
    ["null", { missing: null }],
    ["boolean", { on: true }],
  ]) {
    test(`rejects a ${label} leaf`, () => {
      const errors = treeErrors(tree);
      assert.equal(errors.length, 1);
      assert.match(errors[0], new RegExp(`${label} values are not supported`));
    });
  }

  test("rejects a dotted key colliding with real nesting", () => {
    const errors = treeErrors({ "a.b": "x", a: { b: "y" } });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /same key/);
  });
});

describe("parseFile", () => {
  test("reports invalid JSON without throwing", () => {
    const file = parseFile("en", "{ nope");
    assert.match(file.errors[0], /invalid JSON/);
    assert.equal("tree" in file, false);
  });

  test("prefixes shape errors with the tab title", () => {
    assert.match(parseFile("es", '{"a": [1]}').errors[0], /^\[es\] a:/);
  });
});

describe("stringifyFile", () => {
  test("keeps a file that ends without a newline", () => {
    const file = parsedFile("en", '{\n  "a": "x"\n}');
    assert.equal(stringifyFile(file, fileStrings(file)).endsWith("}"), true);
  });
});

describe("tabsByTitle", () => {
  test("finds top-level and nested tabs", () => {
    const doc = {
      tabs: [
        {
          tabProperties: { title: "English" },
          documentTab: { body: { content: [] } },
          childTabs: [
            {
              tabProperties: { title: "Español" },
              documentTab: { body: { content: [] } },
            },
          ],
        },
      ],
    };
    const tabs = tabsByTitle(doc);
    assert.ok(tabs.get("English"));
    assert.ok(tabs.get("Español"));
    assert.equal(tabs.get("Deutsch"), undefined);
  });

  test("returns an empty map for a tabless document", () => {
    assert.equal(tabsByTitle({}).size, 0);
  });
});

describe("replaceValues", () => {
  test("keeps the current file's key order and nesting", () => {
    const current = { a: "old a", nested: { b: "old b", c: "old c" } };
    const flat = new Map([
      ["nested.b", "new b"],
      ["a", "new a"],
      ["nested.c", "old c"],
    ]);
    const next = replaceValues(current, flat);
    assert.deepEqual(next, {
      a: "new a",
      nested: { b: "new b", c: "old c" },
    });
    assert.deepEqual(Object.keys(next), ["a", "nested"]);
  });
});
