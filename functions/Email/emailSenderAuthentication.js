'use strict'

// security audit 2026-11 (NV-06): an inbound Anna email is routed to an Alldone account by its SMTP
// envelope sender, and an envelope sender is only what the sending server claims. The Cloudflare
// worker (cloudflare/email-worker/src/senderAuthentication.mjs) verifies the message's DKIM
// signatures itself and forwards the results as `senderAuthentication`; this module decides whether
// they prove the sender:
//
//   - a DKIM signature that VERIFIED, whose d= domain is aligned with the envelope sender's domain
//     (equal, or one is a subdomain of the other - DMARC's relaxed alignment without a public-suffix
//     list; a d= of a bare public suffix cannot publish a key anybody controls), or
//   - an SPF pass for exactly the envelope sender's domain, which the worker forwards only when the
//     deployment trusts Cloudflare's own Authentication-Results stamp (TRUST_CLOUDFLARE_AUTH_RESULTS).
//
// A valid signature from some OTHER domain proves nothing about the sender: anybody can sign mail
// with their own domain's key and put a victim's address in MAIL FROM.
//
// Rollout: a worker deployed before this change sends no `senderAuthentication` at all. Until
// LEGACY_WORKER_GRACE_UNTIL_MS such a payload keeps the old behaviour (with a warning), so merging
// the functions before `wrangler deploy` cannot lock every user out of Anna email. After that date
// a missing verdict is treated as unauthenticated. The worker hop itself is authenticated with the
// bearer token, so only our worker can claim a verdict.
const SENDER_AUTHENTICATION_VERSION = 1
const LEGACY_WORKER_GRACE_UNTIL_MS = Date.UTC(2026, 10, 23)

function domainOf(email) {
    const value = String(email || '')
        .trim()
        .toLowerCase()
    const at = value.lastIndexOf('@')
    return at === -1 ? '' : value.slice(at + 1).replace(/\.$/, '')
}

function normalizeDomain(domain) {
    return String(domain || '')
        .trim()
        .toLowerCase()
        .replace(/\.$/, '')
}

function isAlignedDomain(signingDomain, senderDomain) {
    const signer = normalizeDomain(signingDomain)
    const sender = normalizeDomain(senderDomain)
    if (!signer || !sender || !signer.includes('.')) return false
    return signer === sender || sender.endsWith(`.${signer}`) || signer.endsWith(`.${sender}`)
}

function evaluateSenderAuthentication(payload = {}, { now = Date.now() } = {}) {
    const senderDomain = domainOf(payload.fromEmail)
    const verdict = payload.senderAuthentication
    if (!senderDomain) return { authenticated: false, reason: 'no_sender_domain' }

    if (!verdict || typeof verdict !== 'object') {
        if (now < LEGACY_WORKER_GRACE_UNTIL_MS) {
            return { authenticated: true, reason: 'legacy_worker_grace', legacy: true }
        }
        return { authenticated: false, reason: 'missing_verdict' }
    }
    if (Number(verdict.version) !== SENDER_AUTHENTICATION_VERSION) {
        return { authenticated: false, reason: 'unsupported_verdict_version' }
    }

    const signatures = Array.isArray(verdict.dkim) ? verdict.dkim : []
    const alignedPass = signatures.find(
        signature => signature && signature.result === 'pass' && isAlignedDomain(signature.domain, senderDomain)
    )
    if (alignedPass) {
        return {
            authenticated: true,
            reason: 'dkim_aligned_pass',
            method: 'dkim',
            domain: normalizeDomain(alignedPass.domain),
        }
    }

    const spf = verdict.spf
    if (spf && spf.result === 'pass' && normalizeDomain(spf.domain) === senderDomain) {
        return { authenticated: true, reason: 'spf_pass', method: 'spf', domain: senderDomain }
    }

    return {
        authenticated: false,
        reason: signatures.some(signature => signature && signature.result === 'pass')
            ? 'dkim_pass_not_aligned'
            : signatures.length
              ? 'dkim_not_passed'
              : 'no_dkim_signature',
        dkim: signatures.slice(0, 5).map(signature => ({
            domain: normalizeDomain(signature && signature.domain),
            result: String((signature && signature.result) || ''),
        })),
    }
}

module.exports = {
    SENDER_AUTHENTICATION_VERSION,
    LEGACY_WORKER_GRACE_UNTIL_MS,
    isAlignedDomain,
    evaluateSenderAuthentication,
}
