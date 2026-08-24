import type { GoogleDocument, Options } from "../src/index.ts";
import gdocToText from "../src/index.ts";

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const assertType = <_Assertion extends true>(): void => {};

assertType<Exact<ReturnType<typeof gdocToText>, string>>();
assertType<
  Exact<Options["format"], "markdown" | "html" | "plain" | undefined>
>();
assertType<Exact<Parameters<typeof gdocToText>[1], Options | undefined>>();

const document: GoogleDocument = {
  body: {
    content: [
      {
        paragraph: {
          bullet: {},
          elements: [
            {
              textRun: {
                content: "hi",
                textStyle: { bold: true, link: { url: "https://example.com" } },
              },
            },
            {
              richLink: { richLinkProperties: { uri: "https://example.com" } },
            },
            { person: { personProperties: { email: "a@example.com" } } },
          ],
        },
      },
    ],
  },
};

gdocToText(document);
gdocToText({});
gdocToText(document, {});
gdocToText(document, { format: "markdown" });
gdocToText(document, { format: "html" });
gdocToText(document, { format: "plain" });

// @ts-expect-error - the document is required
gdocToText();
// @ts-expect-error - a Docs API response, not the text of one
gdocToText("hello");
// @ts-expect-error - unknown format
gdocToText(document, { format: "text" });
// @ts-expect-error - the option is `format`, not `links`
gdocToText(document, { links: "markdown" });
