// AT-2921: an assistant request's HTTP response is not the only evidence of what happened to it.
//
// The Anna composer starts the run with a long callable (`askToBotSecondGen`). On a phone the OS
// drops that connection as soon as the app goes to the background, and the Firebase callable SDK
// turns ANY failed `fetch` into `FunctionsError('internal', 'internal')` (status 0 in
// `postJSON`). The server, meanwhile, keeps running, finishes, and persists the answer. Reported
// as a red "internal" + "Retry" on the question while the full answer sat right under it.
//
// So a failure is judged by two things, in this order:
//   1. what the chat itself says — a persisted reply carrying `assistantRun.triggerMessageId`
//      proves the server took the request, whatever the transport reported;
//   2. how the request failed — a transport loss after the request was handed to the callable
//      is "unknown", not "failed", and waits for (1) before anything is shown.

// Status-0 failures: the SDK cannot tell a dropped connection from a backend crash that lost its
// CORS headers, and reports both with this exact lower-case message. A backend that answered with
// an error body reports `INTERNAL` (upper case) or its own message instead, which stays a failure.
const TRANSPORT_MESSAGE = 'internal'
const TRANSPORT_CODES = new Set(['internal', 'functions/internal'])
// The SDK's own client-side timeout, and the fetch rejections of browsers that surface them raw.
const TIMEOUT_CODES = new Set(['deadline-exceeded', 'functions/deadline-exceeded'])
const FETCH_FAILURE = /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?)$/i

// The server answers a comment whose request never arrived 90s after it was stored
// (`MISSED_RUN_GRACE_SECONDS`, AT-2848), plus a cold start. Within this window from saving the
// message, a missing reply is still expected to appear on its own.
export const SERVER_CATCH_UP_MS = 120000
// After returning to the page, give the chat listener time to reconnect and deliver what the
// server wrote while the page was hidden.
export const VISIBLE_CONFIRMATION_MS = 15000

export const REPLY_FAILED = 'failed'

export function isConnectionLoss(failure) {
    if (!failure) return false
    const code = typeof failure.code === 'string' ? failure.code : ''
    const message = typeof failure.message === 'string' ? failure.message : ''
    if (TRANSPORT_CODES.has(code) && message === TRANSPORT_MESSAGE) return true
    if (TIMEOUT_CODES.has(code)) return true
    return failure.name === 'TypeError' && FETCH_FAILURE.test(message)
}

// Map of triggerMessageId -> assistantRun status for one thread's persisted chat runs. A reply
// that is still running, completed, or stopped by the user all prove the request was processed.
export function getAssistantReplies(messages) {
    const replies = {}
    ;(messages || []).forEach(message => {
        const run = message?.assistantRun
        if (run?.kind === 'chat' && run.triggerMessageId) replies[run.triggerMessageId] = run.status || 'running'
    })
    return replies
}

export function replyConfirmsProcessing(status) {
    return !!status && status !== REPLY_FAILED
}

// When to stop waiting for a reply after a transport loss: never before the server's own
// catch-up could have answered, and never before the page has been visible for a moment.
export function getConfirmationDeadline({ now, savedAt }) {
    return Math.max(now + VISIBLE_CONFIRMATION_MS, (savedAt ?? now) + SERVER_CATCH_UP_MS)
}
