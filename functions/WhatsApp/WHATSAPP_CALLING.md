# WhatsApp Assistant Calling

WhatsApp assistant calling is disabled by default. Configure these Firebase Functions runtime environment variables or
secrets before enabling it:

-   `WHATSAPP_CALLS_ENABLED=false`
-   `OPENAI_PROJECT_ID`
-   `OPENAI_WEBHOOK_SECRET`
-   `WHATSAPP_CALL_ROUTING_SECRET`
-   `OPENAI_REALTIME_MODEL=gpt-realtime-2`
-   `OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper`
-   `OPENAI_REALTIME_REASONING_EFFORT=medium`
-   `WHATSAPP_CALL_MAX_DURATION_SECONDS=1800`

For this repository's GitLab production deployment, add the call settings to the existing protected
`GOOGLE_FUNCTIONS_ENV_PROD` JSON variable. Keep the existing `OPEN_AI_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM` entries. The equivalent staging variable is
`GOOGLE_FUNCTIONS_ENV_DEV`.

`OPENAI_PROJECT_ID` is the `proj_...` ID from OpenAI Project settings. Create an OpenAI webhook for
`realtime.call.incoming` using the deployed `openAIRealtimeCallWebhook` URL and store the signing secret shown during
creation as `OPENAI_WEBHOOK_SECRET`. Generate `WHATSAPP_CALL_ROUTING_SECRET` independently using at least 32 random
bytes.

Twilio's WhatsApp sender must have WhatsApp Business Calling enabled. Its TwiML Voice Application should send inbound
calls to `whatsAppIncomingCall` and status callbacks to `whatsAppCallStatusCallback`. Register
`openAIRealtimeCallWebhook` as the OpenAI project webhook for `realtime.call.incoming`.

Calls are routed directly from Twilio to OpenAI SIP over TLS. Alldone stores text transcripts in the call-start day's
WhatsApp topic and sends a short recap afterward. Audio recording is not enabled.

## Staging prerequisites

Before testing, complete Meta Business Verification and reach Meta's required messaging limit of at least 2,000
business-initiated conversations in a rolling 24-hour period. Enable WhatsApp Business Calling on the Twilio sender,
connect its Voice Endpoint Configuration to a TwiML Voice Application whose Voice Request URL is
`whatsAppIncomingCall`, and register `openAIRealtimeCallWebhook` for OpenAI `realtime.call.incoming` events.

The Firebase Admin SDK service account used by `functions/firebaseConfig.js` must be allowed to enqueue the
`runWhatsAppRealtimeCall` task function. Follow the repository IAM guidance and grant Cloud Tasks enqueue permission
to that Admin SDK service account, not the compute/runtime service account.

Keep `WHATSAPP_CALLS_ENABLED=false` through deployment and staging setup. Test eligible and ineligible callers,
interruptions, confirmed and rejected sensitive tools, transcript continuity, Gold exhaustion, and the 30-minute
cutoff before enabling the flag in production.

## Monitoring

Call session documents expose setup latency, duration, completion reason, WebSocket reconnects, confirmation request
and decision counts, OpenAI error codes, token usage, and billed Gold. Twilio terminal statuses and OpenAI accept or
sideband failures are recorded without phone numbers, routing tokens, transcript content, or provider error bodies.
