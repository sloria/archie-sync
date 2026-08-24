# archie-sync

Use Google Docs with [ArchieML](https://archieml.org/) as a lightweight CMS.

```sh
# Pull from Google Doc. Each tab becomes a JSON file in --dir
npx archie-sync pull  --dir src/locales

# Push JSON to Google Doc
npx archie-sync push  --dir src/locales
```

For more detailed documentation, see the [archie-sync README](packages/archie-sync/README.md).

This repo also houses [gdoc-to-text](packages/gdoc-to-text/README.md), which converts a Google Docs API response into plain text.
