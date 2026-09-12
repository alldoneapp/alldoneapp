# Anna mode

Anna is a separate hostname entry into the existing alldone application. `anna.alldone.app` enables the new shell; `my.alldone.app` keeps the existing interface. Both use the same production Firebase project and existing authenticated data.

## Experience

- Desktop: continuous conversation on the left, assistant presence or the real routed workspace on the right.
- Mobile: compact assistant presence above the conversation; when work is open, an expandable conversation dock sits below it. Back closes the expanded conversation before leaving the workspace.
- Tasks, notes and goals use existing screens, editors, permissions and navigation. Search opens the existing global search.
- The user's existing default assistant provides its identity, photo, configured tools and model. No replacement assistant is created.
- Voice uses the existing GPT-Live 1 browser call provider, billing, microphone controls, transcript persistence and server controller. Voice and typed messages share the same topic. Typed sends are disabled during a voice call.
- The presence view currently uses the assistant's photo. HeyGen/LiveAvatar video is not implemented or configured.
- The composer supports text. Existing message rendering supports previously attached content; adding attachments through this composer is not yet implemented.

## Persistent conversation

`getAnnaConversationSecondGen` resolves the default assistant and transactionally creates or reuses one owner-private topic, `anna_<uid>`. Its stable home project is stored in the owner-only `users/<uid>/private/annaConversation` document. A changed default project does not silently replace the conversation. Lost access to the home project produces an actionable error.

The normal comments, assistant run locking, pagination and context compaction remain in use. Sending saves the visible workspace context and user message before invoking `askToBotSecondGen`. Retrying reuses the saved message ID and existing backend run lock.

## Assistant presentation

The `show_workspace` tool is added implicitly only for a verified owner Anna conversation. It is available to both text and GPT-Live backend reasoning without changing the assistant's stored allowed tools.

The server validates project membership, object visibility, IDs and canonical routes before writing an `annaPresentation` command on the private topic. The client opens that route in the existing navigator. A pinned workspace or focused editor defers the request until the user opens it. Hidden workspace content remains mounted when returning to the portrait.

Presentation acknowledgements distinguish queued, deferred, opened, dismissed and failed requests. An opened acknowledgement means navigation was requested; it is not proof that an asynchronous editor finished rendering. Previously saved presentation commands are not replayed on reconnect.

## Local review

Use Node 22/npm 10 and `npm run dev`, then visit `https://localhost:19006/?anna=1`. The flag stays in session storage across routes. `?anna=0` restores the ordinary local interface. The existing local environment configuration determines whether this uses staging or production; do not change it casually.

Focused checks:

```sh
npx jest --config ci/jest.web.config.js --runInBand components/Anna components/UIComponents/AssistantVoiceCallButton.test.js components/UIComponents/assistantCallPageContext.test.js utils/webFirebaseAuth.test.js utils/sheetHistoryLayers.test.js __tests__/AssistantFullscreenIndependence.test.js
npx jest --config ci/jest.functions.config.js --runInBand functions/Assistant/annaWorkspace.test.js functions/Assistant/toolSchemas.test.js functions/Assistant/assistantHelper.test.js functions/WhatsApp/assistantLiveBackend.test.js functions/WhatsApp/assistantBrowserCall.test.js
npm run build-web-webpack
```

## Production rollout

The Firebase Hosting custom domain is registered on the existing production site `alldonealeph`. Rollout uses the same application bundle and production data; the hostname selects the Anna shell.

1. Publish DNS CNAME `anna` to `alldonealeph.web.app` at the authoritative DNS provider. Wait for Firebase ownership and TLS certificate verification.
2. Add `anna.alldone.app` to Firebase Authentication authorized domains. Add `https://anna.alldone.app/__/auth/handler` to the existing Google OAuth client's authorized redirect URIs. Verify Google sign-in on the new origin, including mobile.
3. Deploy `getAnnaConversationSecondGen`, `askToBotSecondGen` and `runWhatsAppRealtimeCall` from the reviewed source using the existing production configuration and correct Admin SDK service account. These latter two are shared by the existing interface.
4. Build with production frontend configuration and deploy the Hosting bundle. The hostname check selects Anna only on the new domain. Do not deploy a bundle built with staging configuration.
5. Verify one persistent conversation across reloads, text and voice transcripts, assistant-triggered task/note navigation, pin/defer behavior, mobile keyboard/back behavior and the normal `my.alldone.app` interface. Exercise a real GPT-Live call, transcript persistence, tool action and clean hangup.

The user explicitly authorized the remaining production configuration and deployment on 2026-09-12 after completing DNS. The CNAME is confirmed by the authoritative nameserver and Firebase; Firebase Authentication now authorizes `anna.alldone.app`. The existing production Google OAuth client now includes `https://anna.alldone.app` as a JavaScript origin and `https://anna.alldone.app/__/auth/handler` as a redirect URI. Existing entries were preserved.

Release source: local commit `31311278de`. The isolated production bundle uses Firebase project `alldonealeph` and OTA version `31311278de`, channel `ci`; the workspace staging configuration was preserved. Deployment and live verification results follow below.

## Verification on 2026-09-12

- Focused web checks: 8 suites, 76 tests passed. Focused Functions checks: 5 suites, 339 tests passed.
- Production-mode webpack builds passed with both staging and production frontend configuration.
- Browser inspection used the real signed-in staging account: default assistant resolved correctly, tasks and notes rendered in the workspace, mobile conversation expanded at 390 x 844, and Back collapsed it without leaving the notes route.
- The new conversation endpoint and the previously missing text endpoint were deployed to staging. A real assistant request returned `Anna interface test OK` in the same persisted conversation.
- The subsequent AI-driven presentation test was blocked by the staging account's Gold balance. The presentation permission boundary and client pin/defer/open behavior passed automated tests, but their combined live model interaction remains to be verified.
- No microphone call was placed. GPT-Live integration passes the existing focused browser/backend tests; actual audio, tool presentation during a call, and hangup still need a live smoke test after rollout.

## Pointing and highlighting

Anna can now use `highlight_workspace` in both text and GPT-Live backend reasoning. `inspect` returns an opaque screen ID and up to 60 visible text targets from the right workspace, with at most 240 characters each. `mark` selects one target, optionally an exact unique quote inside it, a short label, and either a yellow marker or a green outline. `clear` removes it. The default lifetime is 12 seconds, bounded to 3–20 seconds.

The client retains the real DOM text-node references. Existing SocialText word spans are grouped into complete phrases. Rectangle overlays follow scrolling and resizing, clip to the workspace, and never modify note contents, DOM text, or the user's selection. They do not click or move the user's mouse. Text changes, detached elements, navigation, expiry, Escape, or the close button remove the marker. A stale screen ID or an unknown target is rejected rather than guessed. Hidden text and input values are excluded; screen text is treated as untrusted reference data.

The client reports `shown` only after resolving a current visible target. Queued tool results are not proof of display. Marking is disabled while the mobile conversation overlays the workspace. Anna is instructed to mark before explaining the selected passage; this does not provide word-level audio timing synchronization.

The marker was verified in the local browser against the real staging notes view by invoking the same server tool handler on the existing private staging conversation. The exact note title was visibly highlighted and a caption rendered. Scrolling moved the marker with the title; Escape removed the overlay while preserving the note. This check did not consume AI Gold or change the note. The tool is included in the production text and GPT-Live handlers deployed below. Live model selection and speech timing on the new domain remain rollout checks.

## Production release on 2026-09-12

- Hosting release completed successfully; `https://my.alldone.app/ota/latest.json` serves version `31311278de`, channel `ci`, built at `2026-09-12T20:27:13.651Z`.
- `getAnnaConversationSecondGen` is active as revision `getannaconversationsecondgen-00001-fey`.
- `askToBotSecondGen` is active as revision `asktobotsecondgen-01004-bet`.
- `runWhatsAppRealtimeCall` is active as revision `runwhatsapprealtimecall-00408-zil`.
- All three use `firebase-adminsdk-mpg7p@alldonealeph.iam.gserviceaccount.com`.
- An unauthenticated request to the new endpoint returns `UNAUTHENTICATED`, as intended.
- The signed-in production browser still renders the normal sidebar, tasks and existing assistant under `my.alldone.app`.
- The latest highlighting checks passed 29 web tests and 332 Functions tests; the production-configured webpack build passed.
- The first Hosting attempt uploaded successfully but failed while resolving Functions metadata during concurrent creation of the new endpoint. Retrying after all three Functions completed succeeded.
- DNS and Firebase ownership are active. Firebase's HTTP certificate challenge matches, but the certificate remains `CERT_VALIDATING` and HTTPS hostname validation is not yet passing. Login, chat, presentation and an actual microphone call on `anna.alldone.app` therefore remain pending certificate activation. No browser certificate warning was bypassed.
- The initial implementation was committed locally and deployed directly, without pushing its source. This release procedure was corrected after the regression below.

## Deployment regression on 2026-09-12

The normal production pipeline `2843573710` deployed `921382bd05b09bd6fea1c64065b5ad7bf99f44f9` after the direct Anna release. Both domains share one Hosting site, so both began serving that build, which did not contain the unpushed Anna commits. This was a missing source integration, not a DNS or browser-cache failure. HTTPS is now valid on the Anna domain.

The Anna commits are being merged with the latest remote `master`, preserving the newer task completion and postponement animations. Anna must be delivered through the regular master pipeline, with the remote source, deployment marker and served OTA version verified together. A direct deployment of unpushed source does not constitute a durable release.
