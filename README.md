# archie-sync

Use Google Docs with [ArchieML](https://archieml.org/) as a lightweight CMS.

```sh
# Pull from Google Doc. Each tab becomes a JSON file in --dir
DOC_ID=... \
GOOGLE_CREDENTIALS_BASE64=... \
npx archie-sync pull --dir src/locales

# Push JSON to Google Doc
DOC_ID=... \
GOOGLE_CREDENTIALS_BASE64=... \
npx archie-sync push --dir src/locales
```

For more detailed documentation, see the [archie-sync README](packages/archie-sync/README.md).
