import { JWT } from "google-auth-library";
import type { PushRequest, TabbedDocument } from "./core.ts";

export class CredentialsError extends Error {}

export function docsClient(scopes: string[]) {
  const credentialsBase64 = process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!credentialsBase64)
    throw new CredentialsError(
      "No credentials. Set GOOGLE_CREDENTIALS_BASE64 to a base64-encoded service account key.",
    );

  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(
      Buffer.from(credentialsBase64, "base64").toString("utf8"),
    );
  } catch {
    throw new CredentialsError(
      "GOOGLE_CREDENTIALS_BASE64 is not base64-encoded JSON. Encode the key with: base64 -i service-account.json",
    );
  }

  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes,
  });
}

export async function fetchDoc(
  client: JWT,
  docId: string,
  params: Record<string, string> = {},
) {
  const query = new URLSearchParams({ includeTabsContent: "true", ...params });
  const res = await client.request({
    url: `https://docs.googleapis.com/v1/documents/${docId}?${query}`,
  });
  return res.data as TabbedDocument;
}

export async function batchUpdate(
  client: JWT,
  docId: string,
  requests: PushRequest[],
  revisionId: string | undefined,
) {
  await client.request({
    method: "POST",
    url: `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    // Fails the write if the doc changed since it was fetched.
    data: { requests, writeControl: { requiredRevisionId: revisionId } },
  });
}
