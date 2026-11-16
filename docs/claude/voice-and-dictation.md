# Voice calls and dictation (Rambler)

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## GPT-Live voice calls (in-app, phone, WhatsApp)

Every assistant call uses GPT-Live (`gpt-live-1`) for speech and client delegation to the current
assistant's configured chat model, instructions, history and tools. Voice is 40 Gold/min with
a 15-second minimum; backend reasoning uses the assistant's normal model rate. In-app calls use
WebRTC; phone and WhatsApp calls arrive over SIP as `live.transport.incoming` and run on the same
`assistantLiveController`, which greets SIP callers itself (no browser gates playback) and keys
transcripts, tool `sourceChannel` and billing on the session's `channel`. The Realtime SIP path
(`realtime.call.incoming`, `OPENAI_REALTIME_MODEL`) is now only a fallback while the OpenAI webhook
subscription still names it. See `functions/WhatsApp/GPT_LIVE_CALLING.md` for session, billing,
interruption, rollout and verification details. Keep the shared chat execution path and
model-specific pricing; do not introduce a separate voice backend model.

**A PSTN phone call is the account holder only when the carrier says so (NV-35).** Twilio passes
the STIR/SHAKEN verdict as `StirVerstat`; `handleIncomingPhoneCall` records it on the session as
`callerVerified` / `callerAttestation`, and only `TN-Validation-Passed-A` counts. Any other value,
or none (international calls, carriers without STIR/SHAKEN, sessions from before this change), makes
`runLiveAssistant` run as an unverified caller (`functions/shared/callerVerification.js`): no
`getOptimizedContextMessages` (no chat history, memory, instructions or project data) and no Anna
context, a fixed context saying the account cannot be used, `runtime.callerIdentityUnverified`, which
`filterAllowedToolsForRuntimeContext`, `isToolAllowedForExecution`, `interactWithChatStream` (no
implicit `load_skill` or wiki tools) and `resolveKnowledgeBaseAccess` all honour, so only `web_search`
remains, and no `post_voice_answer_in_chat`. WhatsApp and in-app calls are not affected. The
transcript still lands in the account's daily topic for display, but each turn carries
`callerUnverified: true`, and `getOptimizedContextMessages` and the WhatsApp `getConversationHistory`
skip such comments, so a later run never reads a stranger's words as the account holder's. Residual:
an unverified call still spends the account's voice Gold.

**A voice call is a read of its topic, so it is gated like one (NV-28).** `startAssistantBrowserCall`
loads the topic's recent comments into a live session the caller controls. `resolveBrowserCallTopic`
therefore requires `projects/{projectId}.userIds` membership and a place in the topic's `isPublicFor`,
the same rule `assertObjectAccess` applies to `askToBotSecondGen`. It used to accept anyone listed in
`creatorId`, `lastEditorId`, `members` or `usersFollowing`, and `members` keeps every former commenter
after a topic is made private.

## Assistant voice calls survive the background differently on every platform (AT-2496)

**The call is a browser WebRTC connection to OpenAI, and the "recording" is a server-side text
transcript.** `AssistantVoiceCallButton` owns the `RTCPeerConnection`, the mic stream and a hidden
`<audio>` element; the Cloud Function only brokers the SDP, and the sideband controller writes
transcript turns into the call topic — no audio is ever recorded. So "the call continues in the
background" means exactly one thing: the peer connection and the capture keep flowing while the
page is hidden. What can keep them flowing is decided per platform, and
`components/UIComponents/assistantCallBackground.js` is the one place that spells it out:
desktop and Android (a TWA renders in Chrome, which owns the mic and its own "microphone in use"
notification) keep a capturing tab alive on their own; the **iOS Capacitor shell** needs the
`audio` entry in `UIBackgroundModes` (`ios-app/ios/App/App/Info.plist`) because WebKit proxies the
web view's AVAudioSession into the host app, so the app's background mode is what keeps the
capture alive after Home / lock; and an **iOS browser or home-screen PWA has no lever at all** —
WebKit mutes the capture track while hidden and unmutes it on return, which is why the connected
state shows a "keep Alldone open" hint there and nowhere else.

Two rules follow and the component wires them to the connection's lifecycle. **A hidden page never
opens the microphone**: `getUserMedia` is refused from a hidden page, and on iOS the muted track
comes back by itself, so a stall or an `ended` track seen while hidden is only remembered
(`micCheckPendingRef`) and replayed once visible — after `RETURN_MIC_SETTLE_MS`, because replacing
the track during the window in which WebKit unmutes the original would drop the first words spoken
after coming back. The first version of the health monitor did the opposite and, on iOS Safari,
called `getUserMedia` from the background on every stall. **A `disconnected` peer connection gets a
visibility-dependent grace** (`resolveDisconnectGraceMs`: 8s visible, 60s hidden), re-armed on
every visibility flip so a call that really died in the background still ends within seconds of
return rather than a minute later; `connected` cancels it and only `failed`/`closed` are terminal
on their own. The iOS shell additionally gets `CallAudioSessionPlugin.swift` (`CallAudioSession` on
`window.Capacitor.Plugins`): `begin()` configures `.playAndRecord`/`.voiceChat` **before** the web
view opens the mic and reports whether the build carries the background mode, `end()` releases
the session **after** the tracks are stopped; both are best-effort and a failing plugin never stops
a call. The Media Session registration is what Android's ongoing-call notification is built from,
and its `hangup` action is the only one wired to anything (play/pause/stop stay inert — a headset
"stop" must not hang up).

Only a device can verify any of it: jest has no WebRTC and no visibility semantics, so
`AssistantVoiceCallButton.test.js` drives the REAL component against a fake peer connection and
pins the rules, not the platform behaviour. Note the suite unmounts every tree it renders — a
still-mounted component keeps its `visibilitychange` listener and reacts to the NEXT test's events
with the next test's `getUserMedia` mock, which is how a "called twice" assertion came back as
three. The Info.plist mode and the plugin are native shell changes and therefore need a TestFlight
/ App Store release; OTA cannot add a background mode.

## Rambler dictation — a microphone can hand the browser digital silence (AT-2357)

On macOS, `getUserMedia({ audio: true })` enables Chrome's default processing chain
(echoCancellation/noiseSuppression/autoGainControl), which routes capture through the system
**Voice-Processing I/O** audio unit. With some input/output device combinations — built-in mic
while output goes somewhere else, virtual audio devices, mic modes — that unit hands the page a
track of **literal digital silence**, while macOS' own input-level meter (which never goes near the
browser) keeps showing a healthy level. It works with AirPods because input and output are then the
same device. **The user-visible symptom is a server error**: MediaRecorder happily encodes the
silence, the blob is non-empty (Opus compresses silence to a few hundred bytes/s) so the client size
guard passes, the clip uploads, Gold is spent, and Deepgram correctly reports nothing —
`EMPTY_TRANSCRIPT` → "No speech detected". The signature in the Cloud Run logs for
`processramblesecondgen` is the **payload size**: the reported failures were 3.7–5.9 KB against
~102 KB for working takes of the same length in the same session.

`hooks/rambleMicCapture.js` therefore measures the captured signal in the browser, and
`useRambleRecorder` acts on it twice. **Before** recording, `acquireDictationStream` probes (≤350ms,
and a healthy mic clears it on the first read) and re-acquires the mic with the processing chain
disabled when the device delivers bit-exact silence or the track is already `muted`; the aliveness
test is `peak > 0`, so any energy at all — including inaudible self-noise — counts as a working
microphone, which is what keeps a quiet room from being mistaken for a dead device. Because the
rescue happens before `MediaRecorder` starts, the broken take never happens and no speech is lost.
**After** recording, a peak below `SILENT_PEAK_THRESHOLD` (~-66 dBFS, three orders of magnitude
under speech) means the take is never uploaded: no Gold, and a message that names the device instead
of blaming the speech. Everything degrades to "unknown" without Web Audio, and **unknown never
blocks an upload** — a false "silent" verdict would throw away a recording the user actually made.

What is remembered, and what retires it, is the fiddly half. A capture that is silent processed
**and** alive raw is the only proof that the processing path is the broken one, so only that
combination writes the learned record (`rambler.captureMode`), and the record carries the
**deviceId** it was learned on. It is retired three ways, because a workaround that outlives its
hardware is the same bug in reverse: a `devicechange` event drops it (plugging in headphones or
switching the system default does **not** change the `"default"` deviceId, so the event is the only
signal there), a recording whose actual device differs from the learned one re-acquires with the
normal defaults and gets a fresh verdict, and a raw capture that is silent too clears it rather than
pinning a degraded mode forever. Above all that sits the user's own setting
(`rambler.micMode`, Settings → Customizations → "Dictation microphone": Automatic / Standard /
Compatibility) — deliberately localStorage and not the user doc, since it describes one machine's
audio hardware. **An explicit choice is obeyed as written**: no probe, no second acquisition, and a
silent take is reported without overriding it. Pinned by `hooks/rambleMicCapture.test.js` and the
`silent microphone (AT-2357)` block in `hooks/useRambleRecorder.test.js`.

**The processing chain was only half of it: the browser also hands you a different microphone than
macOS does.** The first fix shipped and the same user still failed — with an error naming
"MacBook Pro Microphone" while macOS System Settings was set to his webcam, level meter healthy.
A browser keeps its **own** microphone preference (Chrome: Settings → Site settings → Microphone,
and an installed PWA gets a **separate** entry from the browser tab), and a device pinned there, or
a stale cached `"default"`, outranks the system input source. No web API can read or change that
preference — `enumerateDevices` will not tell you which entry the browser would pick, and
`getUserMedia({audio: true})` just returns it. So switching the capture mode on that device could
only ever produce silence more efficiently, which is exactly what the user saw. Two consequences:
**every re-acquisition pins the device** (`deviceId: { exact }` — `ideal` is a preference the
browser may silently ignore, and a silently ignored pin means the probe measured one mic and the
recording used another), and when the acquired device is silent **both** ways the automatic path
**walks the other audio inputs** (`findWorkingInputDevice`, capped at `MAX_FALLBACK_DEVICES`) and
records from the first one that is alive, remembering it as `rambler.inputDevice`. Declining to
record from a device that demonstrably produces nothing is the only lever the page actually has.
Alias entries (`default`, `communications`) are never walk candidates — they point at the hardware
we just measured — and neither are devices sharing its `groupId` or label; a candidate that cannot
be opened is skipped rather than retried unpinned, because the unpinned retry would reopen the
device we are escaping. The learned device retires exactly like the learned mode (devicechange,
still-silent raw), and **an explicit device chosen in Settings → Customizations → "Dictation
microphone" is never walked away from**, same rule as the mode. That row now lists the real devices
(`rambler.micDevice`), which is the only thing that can overrule a browser pinned to the wrong mic;
labels are empty until permission has been granted once, hence the opt-in "Show my microphones".
The failure message had to change too: naming only the device we recorded from reads as an
accusation to someone who picked a different one in macOS, and it sends them to the one place that
cannot fix it — it now says the microphone is the **browser's** choice and points at the picker.
The reporting user confirmed both halves: Chrome's site-settings microphone was pinned to
"MacBook Pro Microphone", and he was in the **installed PWA**, whose entry is separate from the
browser tab's. He also could not open DevTools — which is why `rambler.lastDevice` records the
device each recording actually came from and the picker shows it under "System default": from
inside a page there is otherwise no way to learn which microphone that resolves to, and a settings
row reading "System default" teaches a mis-pinned user nothing.
Pinned by `components/UIControls/RambleButton.test.js` (message branch) plus the device blocks in
the three suites above.

## Holding the floating "+" is a hold on the add-task mic (AT-2823)

Pressing and holding the task board's floating "+" (`FloatingAddTaskButton` → `AddTaskTag`
`holdToDictate`) enters the same push-to-talk mode as holding the mic inside the open add-task popup:
ring, slide-to-cancel, timer, and release → transcribe → create the task. It is **not** a second
recorder. After `PUSH_TO_TALK_HOLD_MS` (400ms) the "+" opens the popup and hands the press still in
progress to the title input's `RambleButton` through `components/UIControls/pushToTalkHandoff.js`
(`AddTaskTag` → `RichCreateTaskModal` → `MainModal` → `TaskEditForm` → `InputArea` →
`CustomTextInput3` → `RambleButton`, prop `pushToTalkHandoff`). The "+" keeps tracking the gesture
with `usePushToTalkGesture`; the mic claims the handoff once, starts recording and shows the ring
immediately, and the forwarded release takes the ordinary `resolvePushToTalkRelease` path. Unlike the
mic, nothing records on press-down, because a tap on "+" must never switch the microphone on, so the
first ~400ms are not captured (product decision). A tap shorter than that opens the popup on release,
as before. Two click traps are handled: the mouse press's trailing `click` would reach the popover's
outside-click dismissal, since the "+" stops taking pointer events once a task editor is open, so
`utils/swallowNextClick.js` consumes it (mouse/pen only, since touch produces none). RNW's
`onPress` is also suppressed for `POINTER_CLICK_SUPPRESSION_MS` so the popup is not remounted, and
keyboard activation still opens it. Pinned by `components/Tags/AddTaskTagHoldToDictate.test.js`
(real `AddTaskTag` + real `RambleButton`, real DOM events) and `pushToTalkHandoff.test.js`.

**Letting go closes the popup at once, and the task is created in the background (PT-5424).** Every
release of a hold closes the popup in `AddTaskTag` (`closePopupNow`), whether the take is submitted,
slid out to cancel or too short, so "+" can be held again for the next task while the previous one is
still being created. That only works because the take outlives the popup, which takes two pieces. The
mic stops a submitting take with `stop({ detach: true })`, and `useRambleRecorder`'s unmount cleanup
then leaves it alone: a real MediaRecorder fires `onstop` after `stop()` returns, i.e. after the
popup unmounted, and the old cleanup cancelled it there, losing the task silently. And
`RichCreateTaskModal` registers `createDictatedTaskInBackground` on the handoff
(`setBackgroundSubmit`) on every render. On release `RambleButton` hands the take to it
(`runDetachedRambleSubmit`): it transcribes under the bottom-left `LoadingData` spinner
(`runWithLoading`) and creates the task through the same `persistNewTask` as Enter, i.e. with the
popup's project and Automatic routing. Nothing is inserted into the closed editor. Failures alert
(`reportRambleProcessingError`, "Task could not be created"); offline stays silent as before because
the connection toast explains it. A hold-opened popup never focuses its title (`InputArea`), which on a
phone would open the keyboard under the finger. The hold starts on "Automatic" in All projects and
on the open project inside a single project. Pinned by the PT-5424 cases in
`AddTaskTagHoldToDictate.test.js`, `useRambleRecorder.test.js`, `FloatingAddTaskButton.test.js`,
`RichCreateTaskModal/InputArea.test.js` and
`__tests__/UIComponents/FloatModals/RichCreateTaskModalBackgroundDictation.test.js`.

**The same holds for a hold on the popup's own title mic (PT-5425).** There is no opener to close
the popup, so the mic asks the host: `RambleButton`'s `claimBackgroundSubmit` →
`CustomTextInput3`'s `claimDictationBackgroundSubmit` → `TaskEditForm` (Enter's guards: mention
picker, tag editor, assignee popup) → `RichCreateTaskModal.claimDictatedTaskInBackground`, which
answers `null` (the interactive insert-then-Enter path stays) or `{ dismiss, submit, onFailed }`.
Order matters: the mic stops the take with `{ detach: true }` FIRST and calls `dismiss` only when
the recorder promised to deliver, so a take too short to keep never closes the popup. A draft with
dropped `blob:` files declines, because the popup revokes them on unmount. `dismiss` also locks the
popup's single-flight guard, so one release creates one task. `CustomTextInput3` splits the draft at
the caret at release time through the same `getFinalText` as typing (`backgroundDictation.js`), and
`submit` receives that composed title plus its linked-object URLs. Every failure (a recorder error
such as a silent microphone, a failed or empty transcription, a failed write, and an `onstop` that
never arrives, after `DETACHED_DELIVERY_TIMEOUT_MS`) reopens the draft in the global
`DictationTaskRecoveryModal` (`dictationTaskRecovery.js`), with the dictated title once it is known.
A failed write after a "+" hold is restored the same way. Pinned by
`components/UIControls/RambleClaimBackgroundSubmit.test.js`, the PT-5425 blocks of
`RichCreateTaskModalBackgroundDictation.test.js` and `useRambleRecorder.test.js`,
`TaskEditFormBackgroundDictation.test.js` and `CommentsTextInput/backgroundDictation.test.js`.

## An empty composer shows the mic where Send sits (AT-3025)

In the four send composers (assistant line `AssistantOptions`, Anna pane `AnnaConversation`, chat
`ChatInput`, comment popup `RichCommentModal/EditForm`), an empty draft no longer shows a greyed-out
send button. The send button's place holds a blue mic (`RambleButton variant="send"`) and the usual
small mic hides, so there is only one mic on screen. With text, Send comes back and the small mic
reappears. One rule decides it: `components/UIControls/composerMicSlot.js`
(`resolveComposerMicSlot`). **The two mics are separate `RambleButton`s that both stay mounted**, and
only `visible` changes. A recorder lives inside its button, so moving one button between the places,
or unmounting the hidden one, would cancel a take whose transcript has just filled the field while
the button was still `processing`. For the same reason a busy mic always keeps its place until it is
idle. The CustomTextInput3 hosts pass `sendSlotDictation={{ target, empty, style }}`: the host owns the
slot node next to its send button, the input portals the blue mic into it and reports
`onSendSlotDictationChange(bool)` from a layout effect, so the host hides Send before paint. Anna
renders both buttons itself. Where dictation is unavailable (offline, unsupported browser,
read-only, editing a chat message, a popup with `hideDoneButton`) the old greyed-out Send stays.
Pinned by `composerMicSlot.test.js`, `RambleSendVariant.test.js`, the AT-3025 blocks in the four
hosts' tests, both `SubmitButton.test.js` files and the wiring guard in `dictationVisibility.test.js`.

## Dictation vocabulary — "Alldone" is a homophone of "all done" (PT-4648)

Transcription biases towards a curated product glossary in **two** places, and both are required.
`functions/shared/transcriptionVocabulary.js` is the single source: `getTranscriptionKeyterms()`
feeds Deepgram's Nova-3 `keyterm` parameter (the acoustic layer, in
`functions/Notes/deepgramTranscribe.js`), and `buildVocabularyPromptSection()` is embedded in the
rambler cleanup **system** prompt (the semantic layer, `functions/Assistant/ramblerCleanup.js` — it
sits in the system message because it never varies, so it belongs in the prefix `prompt_cache_key`
caches).

**One layer is not enough, and the reason is the brand itself.** "Alldone" is pronounced exactly
like the ordinary English phrase "all done", so boosting it acoustically trades one error for its
mirror image: _"are we all done here?"_ starts coming back as _"are we Alldone here?"_. Only the
cleanup LLM has the surrounding sentence and can tell the product from the adjective, which is why
the prompt rule is deliberately **two-sided** — it protects the ordinary phrase as explicitly as it
pushes the brand. This is also why Deepgram's `replace` (find & replace) is **not** used here: a
blind `all done` → `Alldone` rewrite would clobber every legitimate use of the phrase.

**`language: 'multi'`, never `detect_language`.** `keyterm` requires an explicit language, and
`detect_language` is the one mode the docs never bless alongside it. Worse, detection **silently
downgrades the model**: it covers 35 languages, Nova-3 does not, and when the detected language is
missing from the requested model Deepgram walks down Nova-3 → Nova-2 → Nova-1 → Enhanced → Base on
its own. **Nova-2 does not support `keyterm` at all**, so keyterms would have died on exactly the
requests nobody can see. `multi` is Nova-3 multilingual (en, es, fr, de, hi, ru, pt, ja, it, nl)
with **word-level** code-switching, which also fits dictation better than per-clip detection — a
mixed-language sentence cannot be represented by picking one language. Detection would _override_
`language`, so the two must never both be set. The accepted trade-off is that a language outside
those ten transcribes worse than it did under detection; the logged `detectedLanguages` is what
makes that visible if it ever happens.

**Failure is absorbed, not predicted.** Keyterm support per detected language is not documented, and
a rejected parameter would take down dictation for whoever speaks that language — far worse than
losing a spelling boost. So a 4xx-shaped rejection retries **once** without keyterms and sets
`keytermFallback`; a transport/5xx failure is _not_ retried (it would just fail twice and double the
latency of an outage). A silently degraded configuration therefore shows up in the logs instead of
only in transcript quality.

**Adding terms:** distinctive proper nouns only. Deepgram explicitly warns that generic common words
dilute the prompt and cause false boosts, so no `task`/`goal`/`note`/`assistant` — they are
transcribed correctly already and would only cost accuracy elsewhere. Budget is 500 tokens per
request (Deepgram errors past it; the docs recommend 20–50 terms). Casing is preserved, so write
each term exactly as it should appear. **Never use the legacy `keywords` weight syntax**
(`keyterm=Alldone:2`): Deepgram does _not_ error on it — it accepts the whole string as one literal
keyterm and boosts nothing, so it fails silently and looks like keyterm simply not working.

**The static glossary is the floor; a per-user list is merged on top of it.** A workspace's own
proper nouns — colleagues' names, their employers, project and assistant names — are exactly the
words a speech model cannot guess, and they are per-user by definition. `mergeVocabulary` in
`transcriptionVocabulary.js` is the **only** place the final list is decided, and both
`getTranscriptionKeyterms()` and `buildVocabularyPromptSection()` are thin wrappers over it: if the
acoustic and cleanup layers were allowed to hold different lists, the cleanup could "correct" a
spelling Deepgram was told to emit and the two halves would fight. The static glossary is placed
first and can never be displaced by a workspace term — combined cap 40 (`MAX_TOTAL_KEYTERMS`),
dynamic cap 30.

**Do not put a workspace scan on the transcription critical path (~1s today).** The per-user terms
are precomputed into `users/{uid}/private/voiceVocabulary` (owner read/write under the existing
`users/{userId}/{document=**}` rule — **no rules change**, and the Admin SDK writes it), and a
dictation pays exactly **one document read** for them. `functions/shared/userVoiceVocabulary.js`
implements a **stale-while-revalidate** cache: fresh (< 24h) is used as-is; **stale is used anyway**
for the dictation in flight while a rebuild runs alongside it; only a **cold** miss waits, bounded
by `COLD_BUILD_TIMEOUT_MS`, so a user's first-ever dictation already benefits without a slow
workspace costing them their text. The cache read itself is bounded too
(`CACHE_READ_TIMEOUT_MS`) — it sits directly in front of the Deepgram call on every dictation, and
a timed-out read deliberately does **not** fall through to a build, because a degraded Firestore
would only compound the delay. Triggers on contact/project/assistant writes were rejected as
the refresh mechanism (they pay on every contact edit, for every member, to keep a list fresh that
is only consumed when somebody dictates), as was a scheduled rebuild (it scans the workspaces of
users who never touch the microphone). The lazy cache is self-limiting: a user who never dictates
costs nothing, one who dictates fifty times a day rebuilds once.

**The rebuild must be awaited before the response returns.** Cloud Run may freeze the container once
a response is sent, so an un-awaited rebuild is a cache that never fills — the user would silently
get the static glossary forever and nothing would say why. It started before transcription, so by
the time `processRamble` drains it (`VOCABULARY_REBUILD_DRAIN_MS`) it has already had the whole
transcription + cleanup window and costs no wall clock in practice.

**Two things the scan must not do.** It must filter contacts by `isPublicFor` — this runs through
the Admin SDK, which **bypasses security rules**, so without the filter a colleague's private
contact leaks into another user's keyterm list through a spelling hint. And it must stay on
**active** projects (`resolveScopeProjectIds`): on the reporting account that removes 64 guide
projects full of other people's names, which is also the difference between a bounded scan and an
O(projects) one. Caps are `MAX_PROJECTS_SCANNED` 25 / `MAX_CONTACTS_PER_PROJECT` 200, and what was
skipped is reported rather than silently truncated.

**Ranking is written to reject, not to collect** (`functions/shared/voiceVocabularyTerms.js`, pure
functions). A generic keyterm is not neutral — Deepgram warns it dilutes the prompt and costs
accuracy on every other word — so a candidate must clear a stoplist (Alldone's own domain nouns,
organisational filler, role titles, legal-form suffixes, function words in all ten `multi`
languages) **and** a structural check: at least one meaningful word shaped like a proper noun.
The structural check is what generalizes, since no stoplist can enumerate every generic phrase
("my project" is rejected by shape, not by list). Contact given names are deliberately dropped
while surnames are kept as separate terms — a phrase keyterm does not boost its parts, and
"Somova" is the word a model cannot guess whereas "Anna" collides across a contact list. Company
legal forms are stripped ("Heyflow GmbH" → "Heyflow"). Score is source weight × recency ×
cross-project repetition, and ties break alphabetically so an unchanged workspace always produces
an identical list — non-determinism there would churn the `prompt_cache_key`.

**The cap is on TOKENS, not on terms — a term count silently fails for non-Latin workspaces.**
Deepgram's limit is 500 tokens, and 40 Latin names cost ~110 while 40 Japanese organisation names
cost ~750. The failure is invisible: Deepgram 4xx → the keyterm-free retry re-uploads the whole
audio buffer, so that user's acoustic vocabulary (including "Alldone") is permanently dead AND
every dictation pays a doubled round trip, with `keytermFallback: true` as the only symptom.
`mergeVocabulary` therefore spends a `MAX_KEYTERM_TOKENS` budget using `estimateKeytermTokens`,
which deliberately OVER-counts (2 tokens per non-ASCII character, one per two ASCII characters) —
verified never to under-count across Latin, Cyrillic, CJK, Arabic and Thai, since under-counting is
the only direction that breaks the request. A realistic Latin list scores 217 of 450, so the
ordinary case loses nothing. Related and deliberate: `isDistinctiveTerm`'s proper-noun shape check
only means anything for scripts that HAVE case — `toUpperCase()` is the identity for CJK/Arabic/Thai,
which is why the naive `word === word.toUpperCase()` acronym test admitted **every** caseless word.
Those are now admitted on length alone via `hasLetterCase`, with the token budget (not the shape
check) bounding the damage. **Known gap:** `GENERIC_WORDS` is Latin/Cyrillic-only, so a generic
caseless word (「テスト」 = "test") is not filtered.

**An incomplete scan must never overwrite a good vocabulary.** `scanProject` swallows per-project
errors and contributes nothing for a project it could not read, so a transient blip produces a
shorter — possibly empty — list that is indistinguishable from a genuinely smaller workspace.
Persisting it would stamp `updatedAt: now`, i.e. mark it **fresh**: one blip during a background
rebuild would destroy the user's vocabulary and then serve the empty result confidently for 24
hours, with `vocabularyCacheState: 'fresh'` in the logs saying everything was fine. So a rebuild
with `failedProjectCount > 0` is discarded when a cached document already exists (`hasExistingCache`),
and written only on a cold cache, where some terms beat none.

**Every failure degrades to the static glossary and nothing throws into the rambler.** Losing the
personalized boost is a bad day; losing the dictation is a broken feature. `getUserVocabularyTerms`
has no rejecting path at all, a failing project contributes nothing rather than failing the build,
and a failed cache write still returns usable terms for the dictation in flight. In `processRamble`
even the `require`s are inside the try/catch — the same shape as the `loadCleanupContext` incident,
where a module-level throw surfaced to the user as "Failed to transcribe audio" — and the
post-billing summary call is guarded too, since a throw there would charge the user and then return
an error instead of their text. The rebuild is drained on the failure paths as well as the success
one (`failAfterDraining`), because `EMPTY_TRANSCRIPT` is the documented silent-microphone symptom
(AT-2357) and repeats: each attempt would otherwise pay for a full scan and have it killed by the
container freeze.

**Two smaller traps.** The contacts query orders by `__name__` **descending**: contact ids are
timestamp-prefixed push ids, so an unordered `.limit()` returns the OLDEST contacts, dropping
exactly the newest colleagues while the recency multiplier ranks the survivors by freshness. It
falls back to the unordered query if Firestore rejects the ordering, because a missing index would
otherwise make the project contribute nothing at all. And `sanitizeStoredTerms` re-applies the
build path's normalizer and limits to terms read BACK from the cache — that document is writable by
its owner under `users/{userId}/{document=**}`, and a stored term containing a newline would escape
the `- <term>` bullet structure of the cleanup **system** prompt.

**Observability:** `[processRamble] timing` carries `keytermCount`, `keytermFallback`,
`detectedLanguages` and `summarizeVocabularyUsage`'s raw-vs-cleaned **counts** — never the dictated
content, so it is safe to leave on. That is the only way to tell the layers apart: a brand hit
already in `raw` means keyterm caught it, a hit appearing only in `cleaned` means the LLM fixed it,
and a confusable form shrinking from raw to cleaned while the brand grows is the mirror-image error.
Pinned by `functions/shared/transcriptionVocabulary.test.js` and
`functions/Notes/deepgramTranscribe.test.js` — the latter drives the **real** `@deepgram/sdk`
against a mocked `fetch`, because the wire format is the thing that breaks and a mocked SDK would
green-light a comma-joined keyterm that boosts nothing in production.

**The per-user terms are counted in aggregate and NEVER named.** The static glossary is Alldone's
own vocabulary, so `Alldone: 2` in Cloud Logging is fine; the dynamic list is made of contact names
and employers, and `Somova: 1` would put a colleague's surname — plus the fact that this user
dictated it — into the logs. `summarizeVocabularyUsage`'s third argument therefore produces only
`vocabularyDynamic` totals, alongside `vocabularyCacheState` (`fresh` | `stale` | `cold` |
`unavailable`) and `vocabularyDynamicCount`. `cacheState` is the one to watch: a persistent `cold`
or `unavailable` means the rebuild never lands and the personalization is silently doing nothing.
Note `unavailable` is reported — rather than `cold` — when every project in a build failed to read,
because "an outage" and "a cold build of an empty workspace" are exactly the two states that log
line exists to tell apart. Pinned by `functions/shared/voiceVocabularyTerms.test.js` and
`functions/shared/userVoiceVocabulary.test.js`.

**Meeting transcription shares the same helper.** `functions/Notes/transcribeMeeting.js` used to
repeat the Deepgram call inline with its own copy of the options; it now calls
`transcribeAudioBase64`, so the model, formatting and vocabulary cannot drift between the two paths.

## One call UI in both shells (AT-3038)

The main app's floating call panel (`FloatingAssistantVoiceCall.js`, rendered by the provider
whenever Assistant Mode is off) renders the Assistant Mode call controls: `AnnaCallAudioControls`
(level meters, the call's name above the timer, the audio settings popover) and `AnnaCallActions`
(mute, enable call audio, hang up), shared with `AnnaConversation`. The card is
`.anna-floating-call` in `anna.css`; because it sits outside `.anna-shell` it sets the
`--anna-*` variables itself from `annaThemeVariables.js` (the same object `AnnaShell` spreads)
and repeats the shell's base button rules. Two differences from the composer are deliberate: the
settings popover opens above the panel's own layer (`settingsZIndex`, the panel is at 100000) and
never as a bottom sheet (`settingsUseSheet={false}`), because a sheet at the modal z-index would
open underneath the panel. The old `VoiceCallDevices` dropdown grid is gone; device switching is
covered by `AnnaCallAudioControls.test.js`, and `AssistantVoiceCallButton.test.js` drives the
panel through its aria-labelled DOM buttons.
