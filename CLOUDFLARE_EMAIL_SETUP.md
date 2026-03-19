# Cloudflare Anna Email Setup

This repo uses Cloudflare Email Routing + a Cloudflare Email Worker for inbound Anna email, while Firebase remains the system of record for user lookup, queueing, daily email topics, assistant execution, external tools, and outbound replies.

## Architecture

1. Cloudflare receives inbound mail for `anna@...`
2. The Cloudflare Email Worker parses the message and attachments
3. The Worker forwards a normalized JSON payload to Firebase `annaEmailIncomingMessage`
4. Firebase validates the bearer token, resolves the user, stores the daily email thread, runs the assistant, and sends the reply email

## Receiving Domain

- Use a Cloudflare-managed receiving domain or subdomain such as `reply.alldone.app`
- Configure the Anna mailbox on that domain, for example `anna@reply.alldone.app`
- Cloudflare must be authoritative for DNS on the receiving domain/subdomain

## Firebase Environment Variables

Set these in the Firebase functions environment:

- `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN`
- `ANNA_EMAIL_PUBLIC_ADDRESS`
- `SIB_API_KEY`

Recommended values:

- `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN=<long random secret>`
- `ANNA_EMAIL_PUBLIC_ADDRESS=anna@reply.alldone.app`

## Cloudflare Worker Secrets

Set these for the Worker:

- `FIREBASE_EMAIL_WEBHOOK_URL`
- `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN`

Recommended:

- `FIREBASE_EMAIL_WEBHOOK_URL=https://europe-west1-<project-id>.cloudfunctions.net/annaEmailIncomingMessage`
- `ANNA_EMAIL_WEBHOOK_BEARER_TOKEN=<same value as Firebase>`

Optional plain variable:

- `ANNA_PUBLIC_EMAIL=anna@reply.alldone.app`

## Worker Deployment

Worker files live in:

- `cloudflare/email-worker/src/index.mjs`
- `cloudflare/email-worker/wrangler.toml`

Deploy from `cloudflare/email-worker` using Wrangler after setting the secrets.

## Payload Contract

The Worker forwards this JSON to Firebase:

- `messageId`
- `fromEmail`
- `subject`
- `textBody`
- `htmlBody`
- `receivedAt`
- `headers`
- `threadHeaders.replyTo`
- `threadHeaders.inReplyTo`
- `threadHeaders.references`
- `attachments[]`

Each attachment includes:

- `fileName`
- `contentType`
- `contentBase64`
- `sizeBytes`

## Firebase Behavior

Firebase accepts the request only when:

- `Authorization: Bearer <ANNA_EMAIL_WEBHOOK_BEARER_TOKEN>` matches
- the sender matches the user’s verified primary email exactly
- `assistantEmailEnabled` is true

Allowed tools by email remain:

- `create_task`
- reachable `external_tool_*`

## Testing

Run targeted tests:

```bash
npx jest functions/Email/emailChannelHelpers.test.js --runInBand
cd cloudflare/email-worker && npm test
```

## Operational Notes

- The Worker must send inline attachment bytes; Firebase no longer downloads attachments from an inbound provider
- Large emails are limited by Cloudflare Email Routing limits and the Firebase request body size you can practically handle
- The daily topic title remains `Daily email <> {FirstName} {DD MMM YYYY}`
