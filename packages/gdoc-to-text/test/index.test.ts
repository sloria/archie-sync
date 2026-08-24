import assert from "node:assert/strict";
import { describe, test } from "node:test";
import gdocToText, { type GoogleDocument, type Options } from "../src/index.ts";

type Element = Record<string, unknown>;

function textRun(content: string, extra: Element = {}) {
  return { textRun: { content, ...extra } };
}

function link(content: string, url: string) {
  return textRun(content, { textStyle: { link: { url } } });
}

function paragraph(...elements: Element[]) {
  return { paragraph: { elements } };
}

function bulleted(...elements: Element[]) {
  return { paragraph: { bullet: { listId: "kix.a" }, elements } };
}

function richLink(richLinkProperties: Element, extra: Element = {}) {
  return { richLink: { richLinkProperties, ...extra } };
}

function person(personProperties: Element, extra: Element = {}) {
  return { person: { personProperties, ...extra } };
}

// Looser than GoogleDocument models on purpose: much of this suite is about
// elements the converter must ignore.
function doc(...content: Element[]) {
  return { body: { content } } as GoogleDocument;
}

describe("paragraphs", () => {
  test("emits paragraph content verbatim", () => {
    const document = doc(
      paragraph(textRun("title: Field Guide\n")),
      paragraph(textRun("intro: Welcome.\n")),
    );
    assert.equal(gdocToText(document), "title: Field Guide\nintro: Welcome.\n");
  });

  test("prefixes bulleted paragraphs with an asterisk", () => {
    const document = doc(
      bulleted(textRun("First\n")),
      bulleted(textRun("Second\n")),
    );
    assert.equal(gdocToText(document), "* First\n* Second\n");
  });

  test("ignores tables and other non-paragraph structure", () => {
    const document = doc(
      paragraph(textRun("a: 1\n")),
      {
        table: {
          tableRows: [
            { tableCells: [{ content: [paragraph(textRun("b: 2\n"))] }] },
          ],
        },
      },
      { sectionBreak: {} },
      paragraph(textRun("c: 3\n")),
    );
    assert.equal(gdocToText(document), "a: 1\nc: 3\n");
  });

  test("ignores empty and bodyless documents", () => {
    assert.equal(gdocToText({}), "");
    assert.equal(gdocToText({ body: {} }), "");
    assert.equal(gdocToText(doc({ paragraph: {} })), "");
  });

  test("drops a paragraph with no renderable runs, newline included", () => {
    const document = doc(
      paragraph(textRun("a: 1\n")),
      paragraph({ inlineObjectElement: { inlineObjectId: "kix.img" } }),
      paragraph(textRun("b: 2\n")),
    );
    assert.equal(gdocToText(document), "a: 1\nb: 2\n");
  });

  test("flattens bullet nesting to a single asterisk", () => {
    const document = doc({
      paragraph: {
        bullet: { listId: "kix.a", nestingLevel: 2 },
        elements: [textRun("Deep\n")],
      },
    });
    assert.equal(gdocToText(document), "* Deep\n");
  });
});

describe("links", () => {
  for (const [format, expected] of [
    [undefined, "lede: See [this](https://example.com).\n"],
    ["html", 'lede: See <a href="https://example.com">this</a>.\n'],
    ["plain", "lede: See this.\n"],
  ] as [Options["format"], string][]) {
    test(`renders links as ${format ?? "markdown by default"}`, () => {
      const document = doc(
        paragraph(
          textRun("lede: See "),
          link("this", "https://example.com"),
          textRun(".\n"),
        ),
      );
      assert.equal(gdocToText(document, { format }), expected);
    });
  }

  test("merges consecutive runs sharing a link URL", () => {
    const document = doc(
      paragraph(
        textRun("lede: See "),
        link("the ", "https://example.com"),
        link("form", "https://example.com"),
        textRun(".\n"),
      ),
    );
    assert.equal(
      gdocToText(document),
      "lede: See [the form](https://example.com).\n",
    );
  });

  test("keeps consecutive runs with different link URLs separate", () => {
    const document = doc(
      paragraph(
        textRun("lede: "),
        link("a", "https://a.example"),
        link("b", "https://b.example"),
        textRun("\n"),
      ),
    );
    assert.equal(
      gdocToText(document),
      "lede: [a](https://a.example)[b](https://b.example)\n",
    );
  });

  test("keeps a whole-line link's newline outside the markup", () => {
    const document = doc(
      paragraph(textRun("url: ")),
      paragraph(link("Example\n", "https://example.com")),
    );
    assert.equal(gdocToText(document), "url: [Example](https://example.com)\n");
  });

  test("leaves a whitespace-only link run unwrapped", () => {
    const document = doc(
      paragraph(
        textRun("lede:"),
        link(" ", "https://example.com"),
        textRun("x\n"),
      ),
    );
    assert.equal(gdocToText(document), "lede: x\n");
  });

  test("does not escape link text or URLs", () => {
    const document = doc(
      paragraph(
        textRun("lede: "),
        link("A & B <x>", "https://example.com/?a=1&b=2"),
        textRun("\n"),
      ),
    );
    assert.equal(
      gdocToText(document),
      "lede: [A & B <x>](https://example.com/?a=1&b=2)\n",
    );
    assert.equal(
      gdocToText(document, { format: "html" }),
      'lede: <a href="https://example.com/?a=1&b=2">A & B <x></a>\n',
    );
  });
});

describe("emphasis", () => {
  const bold = (content: string) =>
    textRun(content, { textStyle: { bold: true } });
  const italic = (content: string) =>
    textRun(content, { textStyle: { italic: true } });

  test("renders bold and italic as markdown", () => {
    const document = doc(
      paragraph(
        textRun("lede: "),
        bold("very"),
        textRun(" "),
        italic("subtle"),
        textRun("\n"),
      ),
    );
    assert.equal(gdocToText(document), "lede: **very** _subtle_\n");
  });

  test("nests bold italic", () => {
    const document = doc(
      paragraph(
        textRun("lede: "),
        textRun("both", { textStyle: { bold: true, italic: true } }),
        textRun("\n"),
      ),
    );
    assert.equal(gdocToText(document), "lede: **_both_**\n");
  });

  test("renders emphasis as HTML in html format", () => {
    const document = doc(
      paragraph(
        textRun("lede: "),
        textRun("both", { textStyle: { bold: true, italic: true } }),
        textRun("\n"),
      ),
    );
    assert.equal(
      gdocToText(document, { format: "html" }),
      "lede: <strong><em>both</em></strong>\n",
    );
  });

  test("drops emphasis in plain format", () => {
    const document = doc(paragraph(bold("loud"), textRun(" quiet\n")));
    assert.equal(gdocToText(document, { format: "plain" }), "loud quiet\n");
  });

  test("keeps edge whitespace outside the marks", () => {
    const document = doc(paragraph(bold(" spaced "), textRun("next\n")));
    assert.equal(gdocToText(document), " **spaced** next\n");
  });

  test("leaves a whitespace-only styled run as plain whitespace", () => {
    const document = doc(paragraph(bold("a"), italic(" "), bold("b\n")));
    assert.equal(gdocToText(document), "**a** **b**\n");
  });

  test("merges split runs sharing a style", () => {
    const document = doc(paragraph(bold("bo"), bold("ld"), textRun("\n")));
    assert.equal(gdocToText(document), "**bold**\n");
  });

  test("a style change inside a link stays one link", () => {
    const document = doc(
      paragraph(
        link("Goo", "https://example.com"),
        textRun("gle", {
          textStyle: { link: { url: "https://example.com" }, bold: true },
        }),
        textRun("\n"),
      ),
    );
    assert.equal(gdocToText(document), "[Goo**gle**](https://example.com)\n");
  });

  test("a bold whole-line link keeps emphasis inside the link", () => {
    const document = doc(
      paragraph(
        textRun("Example\n", {
          textStyle: { link: { url: "https://example.com" }, bold: true },
        }),
      ),
    );
    assert.equal(gdocToText(document), "[**Example**](https://example.com)\n");
  });
});

describe("smart chips", () => {
  test("renders rich links and person chips", () => {
    const document = doc(
      paragraph(
        textRun("source: Per "),
        richLink({ title: "Example Org", uri: "https://example.org" }),
        textRun(" and "),
        person({ name: "Ada", email: "ada@example.com" }),
        textRun("\n"),
      ),
    );
    assert.equal(
      gdocToText(document),
      "source: Per [Example Org](https://example.org) and Ada\n",
    );
  });

  for (const [name, chip, expected] of [
    [
      "a rich link without a title falls back to its URI",
      richLink({ uri: "https://example.org" }),
      "source: [https://example.org](https://example.org)\n",
    ],
    [
      "a rich link without a URI is dropped",
      richLink({ title: "Example Org" }),
      "source: \n",
    ],
    [
      "a person without a name falls back to their email",
      person({ email: "ada@example.com" }),
      "source: ada@example.com\n",
    ],
    ["a person with no properties is dropped", person({}), "source: \n"],
  ] as [string, Element, string][]) {
    test(name, () => {
      const document = doc(paragraph(textRun("source: "), chip, textRun("\n")));
      assert.equal(gdocToText(document), expected);
    });
  }
});

describe("suggestions", () => {
  test("skips pending insertions, keeps pending deletions", () => {
    const document = doc(
      paragraph(
        textRun("greeting: Hello"),
        textRun(" cruel", { suggestedInsertionIds: ["sug.1"] }),
        textRun(" world", { suggestedDeletionIds: ["sug.2"] }),
        textRun("\n"),
      ),
    );
    assert.equal(gdocToText(document), "greeting: Hello world\n");
  });

  test("skips pending insertions of smart chips", () => {
    const document = doc(
      paragraph(
        textRun("source: "),
        richLink(
          { title: "Ghost", uri: "https://ghost.example" },
          { suggestedInsertionIds: ["sug.1"] },
        ),
        person({ name: "Ada" }, { suggestedInsertionIds: ["sug.2"] }),
        textRun("none\n"),
      ),
    );
    assert.equal(gdocToText(document), "source: none\n");
  });
});
