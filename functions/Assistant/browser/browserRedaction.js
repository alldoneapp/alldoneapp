'use strict'

// Redaction for everything the browser tool emits: what goes back to the model, what is written to
// the audit trail, and what is printed to Cloud Logging.
//
// The split between the two modes is the whole design, and getting it backwards is how a redaction
// layer destroys the feature it protects:
//
// - `redactForModel` removes CREDENTIAL-shaped strings only. The page is the thing the user asked
//   the assistant to read, so an event page's contact address or a ticket price must survive; a
//   bearer token or a card number that happens to be rendered must not, because from there it would
//   enter the conversation, the model provider's logs and every later prompt in the thread.
// - `redactForAudit` additionally removes PII (addresses, phone numbers). The audit trail is a
//   long-lived security record read by whoever investigates a run — it needs to show WHAT happened,
//   not to become a second copy of the personal data on the page.
//
// Typed text is never stored in either: `describeTypedValue` reduces it to a length and a shape.
// A password does not stop being a password because the field was mislabelled.

const REDACTED = '«redacted»'

// Ordered: the more specific patterns run first so a JWT is not partly eaten by the generic
// long-token rule and reported as something else.
const SECRET_PATTERNS = [
    { name: 'private_key', pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
    { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    { name: 'bearer', pattern: /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/gi },
    { name: 'openai_key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
    { name: 'github_token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g },
    { name: 'gitlab_token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/g },
    { name: 'google_key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
    { name: 'slack_token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'aws_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { name: 'e2b_key', pattern: /\be2b_[A-Za-z0-9]{16,}\b/g },
    {
        name: 'assigned_secret',
        // `password: hunter2`, `api_key=abc…` — the label is what makes the value a secret.
        pattern:
            /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?token|auth[_-]?token|otp|totp|mfa[_-]?code)\b\s*[:=]\s*("[^"]{3,}"|'[^']{3,}'|[^\s,;&"'<>]{3,})/gi,
    },
    { name: 'iban', pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{1,4}\b/g },
]

// Applied on top of the secret rules for audit records and logs only.
const PII_PATTERNS = [
    { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { name: 'phone', pattern: /(?:(?<![\w.])\+\d[\d\s()/.-]{7,}\d)|(?:\b0\d[\d\s()/.-]{7,}\d\b)/g },
]

const SENSITIVE_QUERY_PARAM_PATTERN =
    /^(?:.*(?:token|password|passwd|pwd|secret|signature|sig|auth|session|sid|otp|code|key|credential|jwt).*)$/i

function luhnValid(digits) {
    let sum = 0
    let alternate = false
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        let value = Number(digits[index])
        if (alternate) {
            value *= 2
            if (value > 9) value -= 9
        }
        sum += value
        alternate = !alternate
    }
    return sum % 10 === 0
}

/**
 * Card numbers are matched by shape and then confirmed with Luhn. Without the checksum this rule
 * eats order numbers, event ids and phone numbers — which on a ticket page is most of the content
 * the user actually wanted.
 */
function redactCardNumbers(text) {
    let found = false
    const result = String(text).replace(/\b(?:\d[ -]?){13,19}\b/g, match => {
        const digits = match.replace(/\D/g, '')
        if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return match
        found = true
        return REDACTED
    })
    return { text: result, found }
}

function applyPatterns(text, patterns) {
    let output = String(text)
    const kinds = []
    for (const { name, pattern } of patterns) {
        pattern.lastIndex = 0
        if (!pattern.test(output)) continue
        pattern.lastIndex = 0
        output = output.replace(pattern, REDACTED)
        kinds.push(name)
    }
    return { text: output, kinds }
}

function redactSecrets(text) {
    if (typeof text !== 'string' || !text) return { text: typeof text === 'string' ? text : '', kinds: [] }
    const secrets = applyPatterns(text, SECRET_PATTERNS)
    const cards = redactCardNumbers(secrets.text)
    return { text: cards.text, kinds: cards.found ? [...secrets.kinds, 'card_number'] : secrets.kinds }
}

function redactPii(text) {
    if (typeof text !== 'string' || !text) return { text: typeof text === 'string' ? text : '', kinds: [] }
    return applyPatterns(text, PII_PATTERNS)
}

/** Page text and snapshots on their way to the model: credentials out, content intact. */
function redactForModel(text) {
    return redactSecrets(text).text
}

/** Audit records and logs: credentials AND personal data out. */
function redactForAudit(text) {
    const secrets = redactSecrets(text)
    return redactPii(secrets.text).text
}

function containsLikelySecret(value) {
    if (typeof value !== 'string' || value.trim().length < 8) return false
    const secrets = redactSecrets(value)
    if (secrets.kinds.length > 0) return true
    // A high-entropy opaque blob with no spaces is a credential far more often than it is prose the
    // user meant to type into a search box.
    const trimmed = value.trim()
    if (/\s/.test(trimmed)) return false
    return (
        trimmed.length >= 24 && /^[A-Za-z0-9+/=_.-]+$/.test(trimmed) && /\d/.test(trimmed) && /[A-Za-z]/.test(trimmed)
    )
}

/**
 * A URL for a record or a tool result. The path is kept (it is what says which page was visited);
 * userinfo is dropped and any query parameter whose NAME suggests a credential is masked — a
 * one-time login link is a credential that looks exactly like a normal link.
 */
function redactUrl(rawUrl, { mode = 'model' } = {}) {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!value) return ''
    let parsed
    try {
        parsed = new URL(value)
    } catch (error) {
        return mode === 'audit' ? redactForAudit(value) : redactForModel(value)
    }
    parsed.username = ''
    parsed.password = ''
    const params = parsed.searchParams
    const keys = Array.from(params.keys())
    for (const key of keys) {
        if (SENSITIVE_QUERY_PARAM_PATTERN.test(key)) params.set(key, REDACTED)
    }
    parsed.hash = parsed.hash ? '#…' : ''
    const serialized = parsed.toString()
    return mode === 'audit' ? redactForAudit(serialized) : redactForModel(serialized)
}

/**
 * What the audit trail records about typed text. The value itself is never persisted anywhere in
 * Alldone: the worker receives it, the page receives it, and the record keeps its shape.
 */
function describeTypedValue(value) {
    const text = typeof value === 'string' ? value : ''
    return {
        length: text.length,
        looksSecret: containsLikelySecret(text),
        shape: !text
            ? 'empty'
            : /^\d+$/.test(text)
              ? 'digits'
              : /^[^@\s]+@[^@\s]+$/.test(text)
                ? 'email'
                : /\s/.test(text)
                  ? 'phrase'
                  : 'word',
        preview: REDACTED,
    }
}

const AUDIT_STRING_MAX = 500

function redactObjectForAudit(value, depth = 0) {
    if (depth > 6) return '«depth-limited»'
    if (value === null || value === undefined) return value
    if (typeof value === 'string') {
        const redacted = redactForAudit(value)
        return redacted.length > AUDIT_STRING_MAX ? `${redacted.slice(0, AUDIT_STRING_MAX)}…` : redacted
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (Array.isArray(value)) return value.slice(0, 25).map(item => redactObjectForAudit(item, depth + 1))
    if (typeof value === 'object') {
        const output = {}
        for (const [key, item] of Object.entries(value).slice(0, 40)) {
            // A field NAMED like a credential is redacted whatever its content looks like.
            if (SENSITIVE_QUERY_PARAM_PATTERN.test(key) || /^(?:text|value)$/i.test(key)) {
                output[key] = typeof item === 'string' ? REDACTED : redactObjectForAudit(item, depth + 1)
                continue
            }
            output[key] = redactObjectForAudit(item, depth + 1)
        }
        return output
    }
    return undefined
}

module.exports = {
    PII_PATTERNS,
    REDACTED,
    SECRET_PATTERNS,
    containsLikelySecret,
    describeTypedValue,
    redactForAudit,
    redactForModel,
    redactObjectForAudit,
    redactPii,
    redactSecrets,
    redactUrl,
}
