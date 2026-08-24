# gdoc-to-text

Convert a Google Doc into plain text.

## Usage

```js
import gdocToText from "gdoc-to-text";
import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/documents.readonly"],
});
const client = await auth.getClient();
const res = await client.request({
  url: `https://docs.googleapis.com/v1/documents/${documentId}`,
});

const text = gdocToText(res.data);
```

The output can feed directly into [ArchieML](https://archieml.org):

```js
import archieml from "archieml";

const data = archieml.load(gdocToText(res.data));
```

## Limitations

Text passes through verbatim (no escaping) so anything that isn't text is dropped: tables, images, and styling that markdown can't express.

If you need a more complete rendering of a doc, use
[@googleworkspace/google-docs-hast](https://github.com/googleworkspace/google-docs-hast).

## TODO

- [ ] Support headers
- [ ] Support strikethrough

## License

MIT
