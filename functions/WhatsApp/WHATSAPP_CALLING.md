# Assistant Voice Calling

Assistant voice calling is disabled by default. Configure these Firebase Functions runtime environment variables or
secrets before enabling each channel:

-   `WHATSAPP_CALLS_ENABLED=false`
-   `PHONE_CALLS_ENABLED=false`
-   `BROWSER_CALLS_ENABLED=false`
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
WhatsApp calls to `whatsAppIncomingCall` and status callbacks to `whatsAppCallStatusCallback`. Register
`openAIRealtimeCallWebhook` as the OpenAI project webhook for `realtime.call.incoming`.

For regular phone calls, enable Twilio Voice on Anna's public voice number (`+49 304 173 5050`) and point its Voice Request
URL to `phoneIncomingCall` with status callbacks to `phoneCallStatusCallback`. The same linked-user lookup is used:
the caller ID must match `users.phone`, and the user must be premium, have positive Gold, and have a default project.

For browser calls, enable `BROWSER_CALLS_ENABLED` after verifying the `startAssistantBrowserCallSecondGen` callable can
create OpenAI Realtime WebRTC sessions. The browser sends only its SDP offer to Alldone; the OpenAI API key and tool
execution stay server-side through the existing sideband controller.

Twilio calls are routed directly from Twilio to OpenAI SIP over TLS. Browser calls use OpenAI Realtime WebRTC. Alldone
stores text transcripts in the call-start day's assistant topic. WhatsApp calls send a short WhatsApp recap afterward;
phone and browser calls store the recap in Alldone. Audio recording is not enabled.

## Assistant-initiated hangup

The assistant can end the call from its side when the conversation is genuinely finished (the caller says goodbye,
asks to hang up, or confirms nothing else is needed). It calls the server-handled `end_call` Realtime tool, which the
sideband controller intercepts and turns into a `POST /v1/realtime/calls/{call_id}/hangup` (the same call used for the
max-duration and Gold-exhaustion cutoffs). This works for all three channels — SIP phone/WhatsApp and WebRTC browser —
because they share one controller. The tool needs no per-assistant opt-in and requires no spoken confirmation. When the
assistant already spoke a farewell in the same turn, the controller waits a short grace window for that audio to finish
playing before hanging up (the sideband WebSocket can't observe SIP/RTP playout completion, so this is time-based);
otherwise it asks for a brief goodbye first. Assistant-ended calls finalize with the `assistant_ended_call` completion
reason and flow through the normal recap/billing path.

## Staging prerequisites

Before testing, complete Meta Business Verification and reach Meta's required messaging limit of at least 2,000
business-initiated conversations in a rolling 24-hour period. Enable WhatsApp Business Calling on the Twilio sender,
connect its Voice Endpoint Configuration to a TwiML Voice Application whose Voice Request URL is
`whatsAppIncomingCall`, and register `openAIRealtimeCallWebhook` for OpenAI `realtime.call.incoming` events.

The Firebase Admin SDK service account used by `functions/firebaseConfig.js` must be allowed to enqueue the
`runWhatsAppRealtimeCall` task function. Follow the repository IAM guidance and grant Cloud Tasks enqueue permission
to that Admin SDK service account, not the compute/runtime service account.

Keep all call channel flags disabled through deployment and staging setup. Test eligible and ineligible callers,
interruptions, confirmed and rejected sensitive tools, transcript continuity, Gold exhaustion, and the 30-minute
cutoff before enabling the relevant flag in production.

## Monitoring

Call session documents expose setup latency, duration, completion reason, WebSocket reconnects, confirmation request
and decision counts, OpenAI error codes, token usage, and billed Gold. Twilio terminal statuses and OpenAI accept or
sideband failures are recorded without phone numbers, routing tokens, transcript content, or provider error bodies.
