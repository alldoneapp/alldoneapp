# AT-2766 voice entry-point audit

Inspected on 2026-10-19, starting at `7c45b3fbd2` on master. Production inspection was read-only and limited to call metadata and relevant webhook logs; no audio or transcripts were read.

## Behavioral fix (2026-10-19, MR !667)

Scope was confirmed: “Bitte einfach fixen, dass überall gpt live benutzt wird.” GPT-live means the app's existing `gpt-live-1` speech session with client delegation to the assistant's configured chat model. Separate dictation, voice-message transcription, text and post-call recap models are unchanged.

- Phone/Twilio, WhatsApp and app session constructors now freeze the same Live provider, model, price and initial ledger before any call can be queued. New routes no longer store `OPENAI_REALTIME_MODEL` as their voice model. Existing records are not rewritten.
- Removed the Realtime SIP acceptance implementation. Signed `realtime.call.incoming` deliveries are acknowledged and logged with `gpt_live_sip_subscription_required` and concrete setup instructions. They cannot accept, reject or consume a route: the same pending SIP call can also deliver a Live event, and only the Live handler may decide its outcome. Both supported Live event names remain accepted.
- The worker refuses new calls with missing/unknown provider metadata rather than selecting the old controller. Only pre-existing legacy records with a confirmed `acceptCompletedAt` and no provider may drain through that controller; their cleanup, recap and billing remain available. Live controller failures propagate without changing providers.
- Shared configuration validation names missing environment variables. SIP requires the OpenAI key, project ID, signing secret and route secret; the app only needs its OpenAI key. Live accept failures are finalized with an actionable diagnostic. A retry with no confirmed acceptance must not queue a controller after an accept error.
- Failed Twilio Dial actions provide callers with a GPT-Live setup/support message; asynchronous status notifications do not send that message. App authentication/model-access failures return an explicit `unavailable` error instead of a generic startup failure.

This is a code fix, **not a production rollout**. The provider-side Live SIP subscription/access still needs verification before deployment; an old-only subscription will now result in an explicit failed call rather than an old-mode conversation. No new environment variable, model override, credential or database migration is introduced.

## Production finding (before the fix)

Legacy voice is still being used. The phone call created on **2026-10-19 at 15:57:55 UTC (17:57:55 Europe/Berlin)** has `channel: phone_call`, `realtimeModel: gpt-realtime-2`, an acceptance timestamp and a completed status, with no Live provider/session metadata. The production `openAIRealtimeCallWebhook` log at 15:58:08 UTC explicitly says `Legacy Realtime SIP event received; call runs on the Realtime model`, followed by `Accepted and queued`. That confirms actual legacy acceptance rather than just an unused configuration value.

The browser calls created at 16:02:46 and 16:04:46 UTC that day have `voiceProvider: gpt-live`, `voiceModel: gpt-live-1` and Live session IDs. Phone and WhatsApp call records from September 28 also show accepted `gpt-realtime-2` sessions. The bounded follow-up query from September 19 to inspection returned nine calls: four legacy phone, two legacy WhatsApp and three Live browser calls, with no unaccepted or unknown sessions and without reaching the 100-call limit. This is not an inventory of every historical call.

Function deployment metadata could not be inspected: the Cloud Functions v2 API returned HTTP 403 for the four queried voice entry points. The available access does not establish the current Twilio configuration, OpenAI webhook subscriptions, project SIP enablement, deployed source revision or effective runtime flags. Receiving a legacy event proves that delivery happened; it does not prove which provider setting caused it.

## Entry points and routing

| Entry                      | Implementation                                                                                                                                                                                | Result                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Standard phone             | `functions/index.js` → `phoneIncomingCall` → `handleIncomingPhoneCall` in `functions/WhatsApp/whatsAppCallTwilioWebhook.js`                                                                   | Validates Twilio signature, linked caller, premium/Gold/project, creates one-use route and user lease, returns Twilio SIP dial to the configured OpenAI project. New session metadata is frozen to GPT-live; acceptance is owned by the Live webhook.                    |
| WhatsApp call              | `whatsAppIncomingCall` → `handleIncomingWhatsAppCall` in the same module                                                                                                                      | Same SIP route and downstream Live-only webhook after the fix.                                                                                                                                                                                                           |
| Live SIP webhook           | `functions/WhatsApp/whatsAppCallOpenAIWebhook.js` → `handleLiveSipCall`                                                                                                                       | Accepts `live.transport.incoming` and deprecated `live.call.incoming` as `gpt-live-1`; uses shared Live controller and billing. The deprecated **Live** event name is not the old Realtime voice mode.                                                                   |
| Legacy SIP webhook         | Same module, `realtime.call.incoming` branch                                                                                                                                                  | Acceptance removed in this MR. Acknowledges/logs the old event without consuming or rejecting the shared SIP leg; only Live events can start a new call.                                                                                                                 |
| App/Anna/browser/iOS shell | `AssistantVoiceCallButton`, `AnnaConversation` → `AssistantVoiceCallProvider` → `useAssistantVoiceCall` → `startAssistantBrowserCallSecondGen` → `functions/WhatsApp/assistantBrowserCall.js` | Requires `gpt-live-v2` client protocol and creates `/v1/live/sessions` with `gpt-live-1`. Older cached clients receive a refresh error before creating a paid call. No Realtime creation fallback found. iOS uses the same web call through its audio/background bridge. |
| Other app launchers        | `AssistantInputLine`, `WhatsAppAssistantLine`, `AssistantOptions`, `GlobalUserPhone`                                                                                                          | Reuse `AssistantVoiceCallButton`; no alternate backend selection found.                                                                                                                                                                                                  |
| Worker                     | `runWhatsAppRealtimeCall` → `functions/WhatsApp/whatsAppCallController.js`                                                                                                                    | Dispatches GPT-live to `assistantLiveController.js`; missing/unknown metadata fails explicitly. Only already accepted legacy sessions can drain on their original controller.                                                                                            |
| Status/cleanup             | Twilio callbacks, `cleanupStaleWhatsAppCalls`, browser end callable                                                                                                                           | Finalize calls, release locks, close the matching provider session and settle billing. Legacy support here is needed while previously accepted calls drain.                                                                                                              |

Before this fix, whichever event family consumed the one-use route first could win. The Realtime handler now leaves the route untouched, so only Live can accept. Changing `OPENAI_REALTIME_MODEL` to `gpt-live-1` would not migrate this protocol; Live uses different endpoints, session events, delegation and billing.

## Configuration, model and UI terminology

- `functions/WhatsApp/assistantLivePricing.js` fixes speech to `LIVE_MODEL = 'gpt-live-1'`. Live delegates substantive work through `assistantLiveBackend.js` to the configured assistant's normal chat model, tools, instructions and permissions. There is no separate Live reasoning-model flag.
- `functions/WhatsApp/whatsAppCallConfig.js` reads `PHONE_CALLS_ENABLED`, `WHATSAPP_CALLS_ENABLED` and `BROWSER_CALLS_ENABLED`, all defaulting to false. These enable channels; none selects Live versus Realtime. Values come from `functions/envFunctionsHelper.js` and the runtime environment, with environment JSON taking precedence when populated.
- `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET` and `WHATSAPP_CALL_ROUTING_SECRET` govern SIP routing and authentication. Production/staging deployment JSON comes from `GOOGLE_FUNCTIONS_ENV_PROD` / `GOOGLE_FUNCTIONS_ENV_DEV` in GitLab CI.
- `OPENAI_REALTIME_MODEL` defaults to `gpt-realtime-2`; transcription defaults to `gpt-realtime-whisper`. They configure the legacy conversation path and WhatsApp post-call recap, not Live speech.
- `assistant.realtimeVoice` and the UI label `Realtime call voice` select a voice such as Marin/Cedar. Both Live and legacy code use the field. It is not a legacy-mode switch. The modal's WhatsApp-only description is outdated because this voice setting also applies to phone and app calls.
- Twilio's `say({ voice: 'alice' })` only explains rejected/ineligible phone calls before hangup; it is not an assistant conversation fallback.

## Separate audio features (unchanged)

- WhatsApp voice-message and media-file transcription: `functions/WhatsApp/whatsAppVoiceTranscription.js` and `whatsAppFileExtraction.js` use `whisper-1`, then normal text assistant handling. These are asynchronous messages, not calls.
- Dictation/rambler and meeting transcription: `functions/Notes/deepgramTranscribe.js`, `transcribeMeeting.js`, `functions/Assistant/processRamble.js` use Deepgram Nova-3 and text cleanup. They do not fall back from a Live call.
- WhatsApp post-call recap: `functions/WhatsApp/whatsAppCallRecap.js` opens a Realtime session with text-only output. It still uses Realtime even after a Live conversation, but callers do not hear it as voice. Phone/browser recap delivery is currently skipped by `sendCallRecap` (some older calling documentation says otherwise).

The confirmed scope is all live conversations using the existing app architecture. Independent transcription and recap generation remain on their existing models.

## Repeatable read-only check

With Node 22 and an existing read-only token exported as `GCP_ACCESS_TOKEN` (or `CLOUDSDK_AUTH_ACCESS_TOKEN`) and `GOOGLE_CLOUD_PROJECT` set:

```bash
node ci/auditVoiceCalls.js 2026-09-19T00:00:00Z 100
```

The optional arguments are the start date and sample limit (1–500); defaults are the last 30 days and 100 calls. The Firestore structured query selects only technical call metadata. It never reads user documents, phone numbers, routing secrets or transcript subcollections. Output groups calls by channel and lists correlation metadata for accepted legacy/unknown sessions. `realtimeModel` on a routing-only session does not count as accepted legacy usage. An accepted session with insufficient provider metadata is reported as unknown rather than assumed Live or legacy.

Exit codes: 0 means no accepted legacy/unknown sessions in the sample; 2 means accepted legacy or unknown sessions were found; 1 means a read/validation failure. `sampleMayBeTruncated` warns when the limit was reached. A zero exit code is evidence about the queried sample, not proof that configuration or all entry points are correct. For a post-rollout check, pass the rollout timestamp so historical legacy sessions do not trigger the check.

Validation:

```bash
npx jest --config ci/jest.web.config.js --runInBand __tests__/ci/auditVoiceCalls.test.js
npx jest --config ci/jest.functions.config.js --runInBand functions/WhatsApp/whatsAppCallOpenAIWebhook.test.js functions/WhatsApp/whatsAppCallTwilioWebhook.test.js functions/WhatsApp/whatsAppCallSessions.test.js functions/WhatsApp/assistantBrowserCall.test.js functions/WhatsApp/assistantLiveController.test.js functions/WhatsApp/whatsAppCallController.test.js functions/WhatsApp/whatsAppCallFlow.test.js
npx jest --config ci/jest.web.config.js --runInBand components/UIComponents/AssistantVoiceCallButton.test.js components/UIComponents/assistantLiveConnection.test.js components/Anna/AnnaConversation.test.js
```

Before the fix, the audit validated 78 backend, 117 app and seven audit tests (202 total), including an old-mode acceptance test. That acceptance test has now been replaced with Live-only regression coverage. Validation for the behavioral fix passed: 328 tests across the full WhatsApp/backend directory, and 124 app/audit tests (452 total); formatting and `git diff --check` also passed. The historical production audit returned exit code 2 and the counts above. No paid calls were placed.

Behavioral regression coverage includes all three channel constructors, old model overrides, every required SIP field, missing app configuration, signed/invalid webhooks, old events before/after Live events, Live acceptance and billing retries, unavailable Live access, provider/controller failures, Twilio Dial failures, and already accepted legacy-call draining.

```bash
npx jest --config ci/jest.functions.config.js --runInBand functions/WhatsApp
npx jest --config ci/jest.web.config.js --runInBand __tests__/ci/auditVoiceCalls.test.js components/UIComponents/AssistantVoiceCallButton.test.js components/UIComponents/assistantLiveConnection.test.js components/Anna/AnnaConversation.test.js
```

A deployment metadata read was retried during implementation: `GET cloudfunctions.googleapis.com/v2/projects/alldonealeph/locations/europe-west1/functions/openAIRealtimeCallWebhook` returned **HTTP 403**, `PERMISSION_DENIED`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, message `Request had insufficient authentication scopes.` The denied method is `google.cloud.functions.v2.FunctionService.GetFunction`. The injected Firestore/Logging token cannot verify deployed revisions or runtime configuration; a token with appropriate Cloud Functions read scope and IAM permission is required. No production credential or provider-console configuration was available for SIP changes or real test calls.

## Rollout verification still required

1. Check the OpenAI project referenced by the deployed `OPENAI_PROJECT_ID`: GPT-Live SIP access, `live.transport.incoming` subscription, signed delivery to `openAIRealtimeCallWebhook`, and removal of the Realtime subscription after Live routing is verified and old deliveries have drained. OpenAI documents that the same pending SIP call can emit both API event families; one handler must own acceptance. See [official SIP documentation](https://developers.openai.com/api/docs/guides/voice-sip?voice-api=live).
2. Verify Twilio phone and WhatsApp incoming/status URLs, SIP TLS/SRTP capability and the correct OpenAI project. Provider changes and deployment require the authorized operator; this MR does not perform them.
3. Verify deployed source revisions and effective channel flags in production/staging, plus Cloud Tasks permissions for the Firebase Admin SDK service account.
4. Test an actual app call, ordinary phone call and WhatsApp call. Confirm `voiceProvider: gpt-live`, `voiceModel: gpt-live-1`, Live accept/sideband, backend model choice, tools, clarification, interruption, transcript persistence, hangup and final Gold. Exercise both an OpenAI and OpenRouter assistant backend.
5. Verify legacy webhook delivery/retries cannot start a new old-mode call after the chosen fix; existing accepted legacy calls must still close and settle safely. Check iOS/Android audio lifecycle on real devices.

No deployment, provider configuration change or merge was performed by this audit.
