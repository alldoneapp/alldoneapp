'use strict'

// A phone call over the public network is matched to an account by its caller ID, and caller ID
// can be forged (security audit NV-35). Twilio passes the STIR/SHAKEN verdict of the originating
// carrier as `StirVerstat`; only full attestation (`TN-Validation-Passed-A`: the carrier knows the
// customer AND that they may use this number) is treated as proof that the account holder is
// calling. Every other value, including no value at all (international calls, carriers without
// STIR/SHAKEN), runs the call as an unverified caller: a voice conversation that can search the
// public web and nothing else. It never sees the account's chats, tasks, notes, mail or memory and
// can neither write nor send anything.

const VERIFIED_STIR_VERSTAT = 'TN-Validation-Passed-A'

// Tools an unverified caller may still use: they read only public information and change nothing.
// Every tool must also be enabled on the assistant itself.
const UNVERIFIED_CALLER_TOOLS = Object.freeze(['web_search'])

function isFullyAttestedStirVerstat(stirVerstat) {
    return String(stirVerstat || '').trim() === VERIFIED_STIR_VERSTAT
}

function isUnverifiedCallerRuntime(toolRuntimeContext) {
    return toolRuntimeContext?.callerIdentityUnverified === true
}

function restrictToolsForUnverifiedCaller(toolNames) {
    if (!Array.isArray(toolNames)) return []
    return toolNames.filter(name => UNVERIFIED_CALLER_TOOLS.includes(name))
}

// A session that does not say its caller was verified is unverified: failing closed covers phone
// sessions created before the attestation was recorded.
function isUnverifiedPhoneCallSession(session) {
    return session?.channel === 'phone_call' && session?.callerVerified !== true
}

module.exports = {
    VERIFIED_STIR_VERSTAT,
    UNVERIFIED_CALLER_TOOLS,
    isFullyAttestedStirVerstat,
    isUnverifiedCallerRuntime,
    restrictToolsForUnverifiedCaller,
    isUnverifiedPhoneCallSession,
}
