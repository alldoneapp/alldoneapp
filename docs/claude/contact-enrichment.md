# Contact profile enrichment

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Contact "Enrich profile" is an assistant run, not a scraper (replaces Apify)

**LinkedIn profile pages cannot be read without a login, and that is the whole reason the Apify
actor existed.** It sold proxies and logged-in sessions; from a Cloud Functions IP a profile URL
answers with a login redirect or a 999, and scraping it breaks LinkedIn's terms. Every field the
contact card actually stores (name, company, role, description, a photo) is also in search-engine
snippets, company team pages, personal sites, GitHub and Gravatar — free and legitimate to read — so
`functions/Apify/` and its two callables are gone, and the button on
`ContactProperties` now calls `enrichContactProfileSecondGen`
(`functions/Contacts/contactProfileEnrichment.js`). That callable hosts an ordinary assistant prompt
run **inside the contact's own chat** (`objectType: 'contacts'`), so it carries the prompt-run
timeout and the per-request run lock like every other host — it is in `ASSISTANT_RUN_HOSTS` and
`RUN_LOCK_HOSTS`, and the client-generated `requestId` doubles as the id of the request comment so a
replayed POST lands on the same comment and the same lock.

Three things are load-bearing. **The run's tools are passed twice, and both halves are needed.**
`aiSettings.allowedTools` (`CONTACT_ENRICHMENT_TOOLS`: `web_search`, `fetch_url`,
`find_profile_photo`, `update_contact`, `get_contacts`) only decides which SCHEMAS the model sees;
the execution gate in `storeChunks` authorises each call against the **assistant document's**
persisted `allowedTools`, which predates the two new tools. The first production run therefore
researched for twenty seconds and died on `Tool not permitted: fetch_url`. A server-authored run
passes the same list as `options.serverGrantedTools`, which `generatePreConfigTaskResult` copies
onto the runtime context and `runToolGrants.resolveRunAllowedTools` unions into the gate — only
Functions code builds that context, so a client cannot grant itself tools this way. An existing
assistant still needs the tools enabled in Tools Access for ordinary chats.

**`update_contact` used to work only on a warm instance.** `updateContactFields` calls the feed and
follower helpers, which read `admin`/`feedCreator`/`project` from the per-instance global state
(`GlobalState/globalState.js`) that every other caller loads first via `loadFeedsGlobalState` —
TaskService, NoteService, the cloud triggers. It never did, so on a cold instance `tryAddFollower`
threw `Cannot read properties of undefined (reading 'firestore')` after the model had done all its
research, and the batch was never committed. `loadFeedsStateForContactWrite` now loads it from the
project document before the write. If a feed helper ever throws that error, look for the missing
`loadFeedsGlobalState` call before suspecting the SDK. **The contact is switched to `isAssistantEnabled: true`**
before the run, because "ask the user which of these two people it is" only works if the user's reply
in the contact chat reaches the assistant, and `createObjectMessage` calls it only when the parent
object says so. And **`fetch_url` refuses LinkedIn and private/link-local addresses up front**
(`webPageFetcher.isFetchableUrl`): the first because a login redirect teaches the model to work
around a page it will never read (the prompt sends it to the search snippet instead — a LinkedIn
result title is literally `Name - Role - Company | LinkedIn`), the second because a model-authored
URL must not be able to point a fetch from inside the Functions network at the metadata server. A
plain fetch that is blocked or returns a JavaScript-only shell falls back to Tavily `extract` when
the key is configured.

`update_contact` widened from "email only" to name, company, role, phone, LinkedIn URL, description
and `photoUrl`; `required` is now `[]` and the executor rejects a call that changes nothing.
The field mapping is the pure `shared/contactEnrichmentFields.js` (description writes both
`description` and `extendedDescription`, as the app's own edit does; a LinkedIn URL must be an
`/in/` profile and is stripped of tracking parameters), and a photo is **copied into our storage**
(`shared/contactPhotoUpload.js`, the same `projectsContacts/…` path the app uses) rather than
hot-linked, since a Gravatar or GitHub avatar changes under the contact. `find_profile_photo` checks
Gravatar (SHA-256 of the lower-cased address, `d=404`), the GitHub API with the `.png` redirect as
a rate-limit fallback, and the `og:image` of pages the assistant already trusts; every miss is
reported in `checked`, never thrown.

Billing is the ordinary metered `assistant_usage` of the run and nothing else (a flat
`contact_enrichment` fee shipped for one afternoon and was removed; the Gold-history label stays for
the entries it wrote). The callable refuses a user with no Gold before touching the thread, matching
the run's own `userGold > 0` gate. The button lives beside the profile edit button at the top of the
card, not on the LinkedIn line. Pinned by
`functions/Contacts/contactProfileEnrichment.test.js`, `functions/Assistant/webPageFetcher.test.js`,
`functions/Assistant/profilePhotoFinder.test.js`, `functions/shared/contactEnrichmentFields.test.js`
and the contact-research block in `toolSchemas.test.js`. Known limits: LinkedIn's own picture and
the structured work history are not recoverable this way, and the follow-up in the chat runs with the
assistant's persisted tools, so an assistant without `fetch_url` enabled can confirm and update but
not read further pages.
