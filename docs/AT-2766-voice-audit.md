# AT-2766 voice entry-point audit

Inspected on 2026-10-19, starting at `7c45b3fbd2` on master. Production inspection was read-only and limited to call metadata and relevant webhook logs; no audio or transcripts were read.

## Production finding

Legacy voice is still being used. The phone call created on **2026-10-19 at 15:57:55 UTC (17:57:55 Europe/Berlin)** has `channel: phone_call`, `realtimeModel: gpt-realtime-2`, an acceptance timestamp and a completed status, with no Live provider/session metadata. The production `openAIRealtimeCallWebhook` log at 15:58:08 UTC explicitly says `Legacy Realtime SIP event received; call runs on the Realtime model`, followed by `Accepted and queued`. That confirms actual legacy acceptance rather than just an unused configuration value.

The browser calls created at 16:02:46 and 16:04:46 UTC that day have `voiceProvider: gpt-live`, `voiceModel: gpt-live-1` and Live session IDs. Phone and WhatsApp call records from September 28 also show accepted `gpt-realtime-2` sessions. The bounded follow-up query from September 19 to inspection returned nine calls: four legacy phone, two legacy WhatsApp and three Live browser calls, with no unaccepted or unknown sessions and without reaching the 100-call limit. This is not an inventory of every historical call.

Function deployment metadata could not be inspected: the Cloud Functions v2 API returned HTTP 403 for the four queried voice entry points. The available access does not establish the current Twilio configuration, OpenAI webhook subscriptions, project SIP enablement, deployed source revision or effective runtime flags. Receiving a legacy event proves that delivery happened; it does not prove which provider setting caused it.

## Entry points and routing

| Entry                      | Implementation                                                                                                                                                                                | Result                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Standard phone             | `functions/index.js` → `phoneIncomingCall` → `handleIncomingPhoneCall` in `functions/WhatsApp/whatsAppCallTwilioWebhook.js`                                                                   | Validates Twilio signature, linked caller, premium/Gold/project, creates one-use route and user lease, returns Twilio SIP dial to the configured OpenAI project. The Twilio route does not choose Live versus Realtime.                                                  |
| WhatsApp call              | `whatsAppIncomingCall` → `handleIncomingWhatsAppCall` in the same module                                                                                                                      | Same SIP route and downstream webhook, hence the same legacy exposure.                                                                                                                                                                                                   |
| Live SIP webhook           | `functions/WhatsApp/whatsAppCallOpenAIWebhook.js` → `handleLiveSipCall`                                                                                                                       | Accepts `live.transport.incoming` and deprecated `live.call.incoming` as `gpt-live-1`; uses shared Live controller and billing. The deprecated **Live** event name is not the old Realtime voice mode.                                                                   |
| Legacy SIP webhook         | Same module, `realtime.call.incoming` branch                                                                                                                                                  | Accepts through `/v1/realtime/calls/{id}/accept` using `config.realtimeModel`; queues old controller without `voiceProvider: gpt-live`. Still callable in master and observed in production.                                                                             |
| App/Anna/browser/iOS shell | `AssistantVoiceCallButton`, `AnnaConversation` → `AssistantVoiceCallProvider` → `useAssistantVoiceCall` → `startAssistantBrowserCallSecondGen` → `functions/WhatsApp/assistantBrowserCall.js` | Requires `gpt-live-v2` client protocol and creates `/v1/live/sessions` with `gpt-live-1`. Older cached clients receive a refresh error before creating a paid call. No Realtime creation fallback found. iOS uses the same web call through its audio/background bridge. |
| Other app launchers        | `AssistantInputLine`, `WhatsAppAssistantLine`, `AssistantOptions`, `GlobalUserPhone`                                                                                                          | Reuse `AssistantVoiceCallButton`; no alternate backend selection found.                                                                                                                                                                                                  |
| Worker                     | `runWhatsAppRealtimeCall` → `functions/WhatsApp/whatsAppCallController.js`                                                                                                                    | Dispatches to `assistantLiveController.js` only when `session.voiceProvider === 'gpt-live'`; otherwise runs the old Realtime controller. Its historical function name alone does not identify the voice mode.                                                            |
| Status/cleanup             | Twilio callbacks, `cleanupStaleWhatsAppCalls`, browser end callable                                                                                                                           | Finalize calls, release locks, close the matching provider session and settle billing. Legacy support here is needed while previously accepted calls drain.                                                                                                              |

The one-use route prevents both incoming event families from handling one call: the first consumed route wins. Keeping both subscriptions can therefore let Realtime win before Live arrives. Changing `OPENAI_REALTIME_MODEL` to `gpt-live-1` would not migrate this protocol; Live uses different endpoints, session events, delegation and billing.

## Configuration, model and UI terminology

- `functions/WhatsApp/assistantLivePricing.js` fixes speech to `LIVE_MODEL = 'gpt-live-1'`. Live delegates substantive work through `assistantLiveBackend.js` to the configured assistant's normal chat model, tools, instructions and permissions. There is no separate Live reasoning-model flag.
- `functions/WhatsApp/whatsAppCallConfig.js` reads `PHONE_CALLS_ENABLED`, `WHATSAPP_CALLS_ENABLED` and `BROWSER_CALLS_ENABLED`, all defaulting to false. These enable channels; none selects Live versus Realtime. Values come from `functions/envFunctionsHelper.js` and the runtime environment, with environment JSON taking precedence when populated.
- `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET` and `WHATSAPP_CALL_ROUTING_SECRET` govern SIP routing and authentication. Production/staging deployment JSON comes from `GOOGLE_FUNCTIONS_ENV_PROD` / `GOOGLE_FUNCTIONS_ENV_DEV` in GitLab CI.
- `OPENAI_REALTIME_MODEL` defaults to `gpt-realtime-2`; transcription defaults to `gpt-realtime-whisper`. They configure the legacy conversation path and WhatsApp post-call recap, not Live speech.
- `assistant.realtimeVoice` and the UI label `Realtime call voice` select a voice such as Marin/Cedar. Both Live and legacy code use the field. It is not a legacy-mode switch. The modal's WhatsApp-only description is outdated because this voice setting also applies to phone and app calls.
- Twilio's `say({ voice: 'alice' })` only explains rejected/ineligible phone calls before hangup; it is not an assistant conversation fallback.

## Other audio features requiring a scope decision

- WhatsApp voice-message and media-file transcription: `functions/WhatsApp/whatsAppVoiceTranscription.js` and `whatsAppFileExtraction.js` use `whisper-1`, then normal text assistant handling. These are asynchronous messages, not calls.
- Dictation/rambler and meeting transcription: `functions/Notes/deepgramTranscribe.js`, `transcribeMeeting.js`, `functions/Assistant/processRamble.js` use Deepgram Nova-3 and text cleanup. They do not fall back from a Live call.
- WhatsApp post-call recap: `functions/WhatsApp/whatsAppCallRecap.js` opens a Realtime session with text-only output. It still uses Realtime even after a Live conversation, but callers do not hear it as voice. Phone/browser recap delivery is currently skipped by `sendCallRecap` (some older calling documentation says otherwise).

Product clarification is pending: confirm that GPT-live means the existing `gpt-live-1` + configured assistant backend; decide whether new legacy SIP calls should be blocked even when an incomplete provider migration would make the call unavailable; clarify whether separate transcription/recap features are in scope. Do not infer these choices from model names.

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

The existing seven backend suites passed (78 tests), including the test that explicitly accepts legacy SIP calls. The three app suites passed (117 tests). The audit command's seven regression cases passed, including incomplete metadata, routing-only sessions, bounded field selection and sanitized failures. Running the command against production since September 19 returned exit code 2 and the counts above. No paid calls were placed.

## Rollout verification still required

1. Check the OpenAI project referenced by the deployed `OPENAI_PROJECT_ID`: GPT-Live SIP access, `live.transport.incoming` subscription, signed delivery to `openAIRealtimeCallWebhook`, and removal of the old Realtime subscription after migration. OpenAI documents that the same pending SIP call can emit both API event families; one handler must own acceptance. See [official SIP documentation](https://developers.openai.com/api/docs/guides/voice-sip?voice-api=live).
2. Verify Twilio phone and WhatsApp incoming/status URLs, SIP TLS/SRTP capability and the correct OpenAI project. Do not change credentials or provider settings as part of this read-only audit.
3. Verify deployed source revisions and effective channel flags in production/staging, plus Cloud Tasks permissions for the Firebase Admin SDK service account.
4. Test an actual app call, ordinary phone call and WhatsApp call. Confirm `voiceProvider: gpt-live`, `voiceModel: gpt-live-1`, Live accept/sideband, backend model choice, tools, clarification, interruption, transcript persistence, hangup and final Gold. Exercise both an OpenAI and OpenRouter assistant backend.
5. Verify legacy webhook delivery/retries cannot start a new old-mode call after the chosen fix; existing accepted legacy calls must still close and settle safely. Check iOS/Android audio lifecycle on real devices.

No deployment, provider configuration change or merge was performed by this audit.
