# Cloudflare Anna Email Setup

This repo uses Cloudflare Email Routing + a Cloudflare Email Worker for inbound Anna email, while Firebase remains the system of record for user lookup, queueing, daily email topics, assistant execution, external tools, and outbound replies.

## Architecture

1. Cloudflare receives inbound mail for `anna@alldoneapp.com`
2. The Cloudflare Email Worker parses the message and attachments
3. The Worker forwards a normalized JSON payload to Firebase `annaEmailIncomingMessage`
4. Firebase validates the bearer token, resolves the user, stores the daily email thread, runs the assistant, and sends the reply email

## Receiving Domain

-   Cloudflare is authoritative for email routing on `alldoneapp.com`
-   The enabled literal route is `anna@alldoneapp.com`

## Firebase Environment Variables

Set these in the Firebase functions environment:

-   `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN`
-   `ANNA_EMAIL_PUBLIC_ADDRESS`
-   `SIB_API_KEY`

Recommended values:

-   `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN=<long random secret>`
-   `ANNA_EMAIL_PUBLIC_ADDRESS=anna@alldoneapp.com`

## Cloudflare Worker Secrets

Set these for the Worker:

-   `FIREBASE_EMAIL_WEBHOOK_URL`
-   `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN`

Recommended:

-   `FIREBASE_EMAIL_WEBHOOK_URL=https://europe-west1-<project-id>.cloudfunctions.net/annaEmailIncomingMessage`
-   `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN=<same value as Firebase>`

Optional plain variable:

-   `ANNA_PUBLIC_EMAIL=anna@alldoneapp.com`

## Worker Deployment

Worker files live in:

-   `cloudflare/email-worker/src/index.mjs`
-   `cloudflare/email-worker/wrangler.toml`

Deploy from `cloudflare/email-worker` using Wrangler after setting the secrets.

## Payload Contract

The Worker forwards this JSON to Firebase:

-   `messageId`
-   `fromEmail`
-   `toEmails[]`
-   `ccEmails[]`
-   `subject`
-   `textBody`
-   `htmlBody`
-   `receivedAt`
-   `headers`
-   `threadHeaders.replyTo`
-   `threadHeaders.inReplyTo`
-   `threadHeaders.references`
-   `attachments[]`

Each attachment includes:

-   `fileName`
-   `contentType`
-   `contentBase64`
-   `sizeBytes`

## Firebase Behavior

Firebase executes an assistant request only when:

-   `Authorization: Bearer <ANNA_EMAIL_WEBHOOK_BEARER_TOKEN>` matches
-   the SMTP envelope sender matches exactly one user’s verified primary email or active connected Gmail identity
-   `assistantEmailEnabled` is true

To/CC recipients never authorize execution. Valid-user replies use reply-all to the sender and original To/CC
recipients, excluding Anna’s own addresses. When additional recipients are present, the assistant receives only the
current email, current-message participant addresses, and an immediately preceding privacy-safe availability result
rather than general earlier daily-email context. Rejection replies for unknown senders remain sender-only.

## Sender Authentication Boundary

-   The Worker authorizes from Cloudflare’s SMTP envelope sender (`message.from`), never the spoofable message-header
    `From` value.
-   Cloudflare Email Routing validates SPF/DKIM and enforces the sender domain’s DMARC policy as part of routing. The
    application does not independently validate DMARC/ARC, so sender authorization still depends on Cloudflare’s
    acceptance of the incoming message.
-   The Firebase webhook bearer token must remain secret. Anyone with that token could bypass Cloudflare and submit a
    sender address directly.
-   Firebase still performs the final exact identity match and requires `assistantEmailEnabled === true` before any
    assistant or tool execution.

Allowed tools by email remain action-only:

-   `create_task`
-   `find_calendar_availability` (returns free options only, never event details)
-   `create_calendar_event`
-   `create_note`
-   `update_note`
-   `update_heartbeat_settings`
-   `create_gmail_draft`
-   `create_gmail_reply_draft`
-   reachable `external_tool_*`

## Testing

Run targeted tests:

```bash
npx jest functions/Email/emailChannelHelpers.test.js --runInBand
cd cloudflare/email-worker && npm test
```

## Operational Notes

-   The Worker must send inline attachment bytes; Firebase no longer downloads attachments from an inbound provider
-   Large emails are limited by Cloudflare Email Routing limits and the Firebase request body size you can practically handle
-   Direct 1:1 emails use `Daily email Anna <> {FirstName} {DD MMM YYYY}`
-   Emails with additional To/CC recipients use a separate daily topic for each exact participant set, titled like
    `Daily email Anna <> {FirstName}, {OtherName} {DD MMM YYYY}`
-   Moving a recipient between To and CC keeps the same daily topic; adding or removing a recipient starts a different
    topic so prior context is not exposed to a changed participant set
-   Calendar availability always represents the authenticated account owner's connected calendars; Anna attributes free
    times to that owner and never describes them as Anna's own availability
