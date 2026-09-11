# In-app GPT-Live calls

The in-app voice transport uses `gpt-live-1` with WebRTC and client delegation. Phone and WhatsApp calls continue through their existing Realtime controller.

`assistantBrowserCall.js` creates a Live session with `store: false`, validates the caller/topic, freezes the voice price, and queues the existing `runWhatsAppRealtimeCall` worker. That worker dispatches Live sessions to `assistantLiveController.js`. The microphone stays disabled until the session starts and the server controller acknowledges readiness.

Each substantive request uses the current assistant's configured model, reasoning effort, instructions, conversation history, permissions and native tool implementations through the shared chat helpers. OpenAI and OpenRouter model routing are shared with chat. Voice has no separate backend model setting. Each model round uses the same token estimate and model-specific Gold divisor as chat. Tool fees still apply through the normal tool implementations.

## Pricing

- Voice: **40 Gold/minute**, calculated from cumulative provider seconds and rounded up to whole Gold.
- Minimum: **15 seconds / 10 Gold**, credited toward total connected time. Silence and muted time count.
- Assistant: its normal configured model rate, plus applicable tool charges.
- The user confirmed **10,000 Gold = EUR 49** on 2026-09-11. Thus voice alone costs EUR 0.196/min retail; provider voice pricing is USD 0.05/min plus backend inference.

Cumulative usage updates and final usage reconcile transactionally with the Gold ledger. Backend rounds have independent deduplication markers. No negative balance is created. Rates are frozen per session/model round. The UI and server share `assistantLivePricing.js`. The owner-only usage summary distinguishes final cost from usage so far when final provider usage is unavailable.

## Transcript and interruption handling

Provider deltas retain their original whitespace/timing in the session's `liveTranscriptFragments` subcollection. Stable display groups update comments without treating each fragment as another chat message. Full backend results are stored separately from spoken transcripts, so returned links remain available in chat even when speech is shortened. No audio recording is added.

Delegation events carry an ID and offset, not a task prompt. The controller waits for transcript context and a short coalescing window; that window is not proof the caller finished speaking. New input invalidates stale execution before tools and subsequent model rounds. Sensitive actions use the existing voice confirmation policy and require unqualified spoken approval of the stored arguments. Tool outcomes are saved before another delegation runs; uncertain actions require state verification before retrying.

After a sideband disconnect, missing speech cannot safely be reconstructed. Reattachment only closes and settles the session. Hangup keeps the event receiver open until `session.closed` or a bounded timeout. The existing browser/iOS/Android microphone and background lifecycle remains in place.

## Delivery and verification

Before starting a paid session, the browser compares available microphone levels over the same short window, with automatic gain disabled during comparison. It selects the strongest sustained signal, stops unused inputs, and keeps the default on a silence tie. The prompt asks the caller to speak during selection. If all inputs produce digital silence, fresh capture with processing disabled handles the known Chrome/macOS capture failure. Audio samples stay on the device. In-call monitoring can recover a silent or interrupted input.

Readiness requires `session.started` plus the controller acknowledgement; an owner-only status read recovers a missed acknowledgement. Blocked playback exposes an explicit enable-audio button. Startup can be cancelled, duplicate starts are guarded, and a late successful provider response is closed through `endAssistantBrowserCallSecondGen`. The controller honors the owner's cancellation flag before further assistant actions and settles ongoing work before publishing final cost.

Deploy the frontend together with `startAssistantBrowserCallSecondGen`, `getAssistantBrowserCallSummarySecondGen`, `endAssistantBrowserCallSecondGen`, `runWhatsAppRealtimeCall`, and the existing `cleanupStaleWhatsAppCalls` scheduled function. Include their shared Functions sources. Existing cached clients are rejected with a refresh instruction before creating a paid session. No new secret is needed; use the configured OpenAI key with GPT-Live access. No Firestore backfill is required; existing Realtime sessions keep their original path and pricing.

`node browser-tests/voice-microphone/run.js` uses Playwright Chromium and synthetic Web Audio inputs to verify stronger-input selection in both directions and recovery from digital silence. It uses an isolated browser and localhost harness, without real microphone access or paid sessions.

Run focused Functions tests with `ci/jest.functions.config.js`, client lifecycle tests with `ci/jest.web.config.js`, and the webpack production build under Node 22. Before production rollout, perform a real call with a configured OpenAI model and an OpenRouter model; check clarification, interruption, tool results/links, hangup, Gold history and final usage. Device testing remains necessary for iOS shell background capture, iOS Safari resume and Android notification hangup.

Official references: [Live delegation](https://developers.openai.com/api/docs/guides/live-delegation), [Live conversations](https://developers.openai.com/api/docs/guides/live-conversations), [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [pricing](https://developers.openai.com/api/docs/pricing).
