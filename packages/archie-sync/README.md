# archie-sync

Sync a Google Doc containing [ArchieML](https://archieml.org/) with local JSON files.
Useful for using Google Docs as a CMS for a static site.

## Usage

```sh
# Pull from Google Doc. Each tab becomes a JSON file in --dir
npx archie-sync pull  --dir src/locales

# Push JSON to Google Doc
npx archie-sync push  --dir src/locales
```

## Initial setup

Create your Google Doc with one tab per JSON file. Each tab's name corresponds to the output file's name (without `.json`).
Create a service account in Google Cloud and give it Editor access to the doc.
Then base64-encode the service account key JSON and set it in the environment variable `GOOGLE_CREDENTIALS_BASE64`.

Locally you can use a `.env` file:

```dotenv
# .env

# The Google Doc's ID from its URL
DOC_ID=fake1qZ8mKf3TnbVx0LpWjHrY6cD9sAe4uNgQ2vRtXkBoMiE
# base64-encoded service account key JSON
# Use: base64 -i service-account.json
GOOGLE_CREDENTIALS_BASE64=fakewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAiY29weS1zeW5jIiwKICAuLi4KfQo=
```

Do an initial `archie-sync push` to fill the tabs in the doc with your local JSON files formatted as ArchieML.

```sh
npx archie-sync push --dir src/locales
```

## Usage with GitHub Actions

Run `pull` on a schedule and open a pull request when the copy changes.
Store the doc ID and the base64-encoded service account key as repository secrets.

```yaml
# .github/workflows/pull-from-doc.yml
name: Pull from Google Doc

on:
  schedule:
    - cron: "0 13 * * 1" # Mondays, 13:00 UTC
  workflow_dispatch:

jobs:
  pull:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npx archie-sync pull --dir src/locales
        env:
          DOC_ID: ${{ secrets.DOC_ID }}
          GOOGLE_CREDENTIALS_BASE64: ${{ secrets.GOOGLE_CREDENTIALS_BASE64 }}
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: copy-updates
          title: "chore: update copy from Google Doc"
          commit-message: "chore: update copy from Google Doc"
          body: Automated pull of the copy Google Doc into `src/locales/`.
```

Pushing the other way overwrites each out-of-date tab, potentially discarding comments and pending suggestions,
so keep it as a manual trigger (`workflow_dispatch`).

```yaml
# .github/workflows/push-to-doc.yml
name: Push to Google Doc

on:
  workflow_dispatch:

jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npx archie-sync push --dir src/locales --yes
        env:
          DOC_ID: ${{ secrets.DOC_ID }}
          GOOGLE_CREDENTIALS_BASE64: ${{ secrets.GOOGLE_CREDENTIALS_BASE64 }}
```

## Usage as a library

```ts
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { parseTab, stringify } from "archie-sync";

// Fetch the Google Doc
const key = JSON.parse(
  Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, "base64").toString(),
);
const client = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/documents.readonly"],
});
const { data: doc } = await client.request({
  url: `https://docs.googleapis.com/v1/documents/${process.env.DOC_ID}?includeTabsContent=true`,
});
// Find a specific tab
const tab = doc.tabs.find((t) => t.tabProperties.title === "en");

// Parse the tab's ArchieML text into an object, e.g. { nav: { home: "Home" } }
const values = parseTab(tab.documentTab);

// And back the other way: JSON object -> ArchieML text
const jsonData = JSON.parse(readFileSync("src/locales/en.json", "utf8"))
stringify(jsonData);
```
