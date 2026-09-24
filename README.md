# Wesley Sources

Private MHB staff dashboard for adding reviewed Methodist sources to Wesley.

It uses Firebase Authentication, Firebase App Check, and the existing
administrator-only Firebase callable functions. It has **no** Supabase
credential, service-role key, or Gemini credential.

## What the first version does

1. A staff member signs in with Google.
2. The dashboard confirms the Firebase custom claim `wesley_admin: true`.
3. The staff member pastes reviewed text, imports a public HTTPS page/link, or
   uploads a small text-based PDF.
4. `importWesleySource` stores PDFs and fetched-page snapshots in the private
   `wesley-sources` bucket, then returns editable extracted text for review.
5. `ingestWesleySource` creates a private draft, chunks reviewed text, and
   generates embeddings.
6. At the final publish step, the staff member confirms the source's usage
   basis, then explicitly calls `publishWesleySourceVersion`.

The public MHB application cannot use any admin operation. Imports never
publish automatically: a staff editor must review the extracted text and
authority, then confirm the usage basis before publishing.

## Local setup

1. In Firebase Console for `mhb-staging`, add a **Web app** for this dashboard.
2. Enable the Google sign-in provider and add the dashboard's local/hosted
   domains to Firebase Authentication's authorised domains.
3. Register the same web app with Firebase App Check using reCAPTCHA Enterprise.
   The backend enforces App Check on every source action.
4. Copy `.env.example` to `.env.local` and fill in the Firebase web-app values.
   These values identify the Firebase web app; they are not server credentials.
5. `kakyireinc@gmail.com` can use the one-time initial administrator activation
   control after signing in. Add later staff through a trusted Firebase Admin SDK
   process; never provide a general browser control that grants this claim.
6. Run:

   ```sh
   npm install
   npm run dev
   ```

The screen shows a configuration notice instead of opening the dashboard when
the environment file is incomplete.

## Source guidance

- Add only official, approved, or licensed Methodist sources.
- Keep one edition/version per import. Revisions should be ingested as a new
  source version, never overwrite an approved version.
- Retain headings and page/chapter references in the text.
- Link imports accept only public HTTPS pages, plain-text documents, or PDFs.
  The importer rejects private/internal addresses, login-protected pages,
  unsupported file types, and redirect chains that are too long.
- PDF uploads and fetched files are limited to 5 MB. PDFs must contain
  selectable text; run OCR before upload when the document is scanned.
- Split large publications by coherent chapter or subject before ingesting.
  The current callable accepts 100 to 80,000 characters per import.
- Only a source title, reviewed text, and authority level are required to save
  a private draft. Publisher, edition/version, topic, jurisdiction, page
  reference, and URL are optional citation details.
- Do not publish a draft until a Methodist editor has checked factual accuracy,
  source authority, and the right to use the text. The usage basis is required
  at publish time, so a draft cannot become available to Wesley without it.

## Deployment

Build the static dashboard with:

```sh
npm run build
```

The included `firebase.json` is configured as a single-page Firebase Hosting
site for `mhb-staging`. Deploy it after registering the final domain in Firebase
Authentication and App Check. Keep staging and production as separate Hosting
sites before publishing a production dashboard.
