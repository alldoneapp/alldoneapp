'use strict'

const admin = require('firebase-admin')

const { normalizeEmailAddress } = require('./emailChannelHelpers')
const { listEmailConnections, resolveEmailConnection } = require('../Integrations/providerConnections')
const {
    PROOF_REJECTED,
    PROOF_VERIFIED,
    ensureEmailIdentityAttestation,
    getAttestedUserIdsForEmail,
    parseCredentialDocId,
} = require('./emailIdentityAttestation')

// Resolving the sender of an inbound Anna email (AT-2483).
//
// One address can genuinely belong to more than one Alldone account, and the first
// version of this lookup could not express that: it poured "this is the account's
// verified login email" and "this address is a mailbox the account has connected" into
// one candidate set and then demanded `size === 1`, returning null otherwise. So the day
// a second account was created whose Google login is an address another account had long
// had connected, forwarding from that address stopped dead — with the reply "I couldn't
// match this sender to a verified Alldone account email", which is the opposite of what
// had happened. The address was matched twice, not zero times.
//
// The evidence is now ranked instead of merged, and only genuine ties inside one rank are
// refused:
//
//   1. connected mailbox (provider-attested) AND verified login email
//   2. connected mailbox (provider-attested)
//   3. verified login email
//   4. connected mailbox whose ownership could not be checked right now
//
// A connected mailbox outranks a login email because it is the deliberate, per-address
// act: you OAuth-connect a mailbox INTO the workspace you want its mail to land in, while
// a login email is merely how you happen to sign in. That ordering is only safe because
// rank 2 requires an attestation from the provider itself (see emailIdentityAttestation.js) —
// the raw Firestore claim is owner-writable, so an unattested connection can never
// outrank an Auth-verified login email, and one the provider actively disowns is dropped
// entirely. Rank 4 is what keeps a Google outage from revoking everybody's routing; it
// only ever wins when nothing better exists, which is exactly the behaviour that shipped
// before attestations existed.

// The mail-carrying halves of the two providers' credential documents. A `calendar`
// document names the same address and is not a mailbox.
const MAIL_CREDENTIAL_SERVICES = new Set(['gmail', 'email'])

// The old limit was 20 and the reporting account was already at 14 for a single address —
// the OAuth documents of every account that ever connected it, including the orphans left
// behind by deleted accounts. Truncation here is silent and ordered by document name, so
// the real account can simply fall off the end; the cap is raised and, more importantly,
// reaching it is now reported.
const CONNECTED_CREDENTIAL_SCAN_LIMIT = 100

const SENDER_STATUS_MATCHED = 'matched'
const SENDER_STATUS_UNKNOWN = 'unknown'
const SENDER_STATUS_AMBIGUOUS = 'ambiguous'

async function findVerifiedUsersByPrimaryEmail(normalizedEmail) {
    const snapshot = await admin.firestore().collection('users').where('email', '==', normalizedEmail).limit(5).get()
    if (snapshot.empty) return []

    const verifiedMatches = []
    for (const doc of snapshot.docs) {
        try {
            const userRecord = await admin.auth().getUser(doc.id)
            const authEmail = normalizeEmailAddress(userRecord.email)
            if (userRecord.emailVerified === true && authEmail === normalizedEmail) {
                verifiedMatches.push({
                    uid: doc.id,
                    ...doc.data(),
                })
            }
        } catch (error) {
            console.warn('Email Channel: Failed verifying auth user for sender routing', {
                userId: doc.id,
                error: error.message,
            })
        }
    }

    return verifiedMatches
}

// Whether the account currently presents this address as one of its connected mailboxes.
//
// Deliberately provider-agnostic and shape-agnostic. `listEmailConnections` reads the
// account-level `emailConnections` map and synthesizes from the legacy per-project
// `apisConnected` map when it is empty — but only one of the two, so an account that has
// the new map AND a legacy-only connection would lose the latter. The legacy map is
// therefore checked as a union rather than as a fallback, and `resolveEmailConnection`
// understands the Microsoft/`emailAddress` shape as well as the old `gmail`/`gmailEmail`
// one, which is why an Outlook mailbox can be a sender at all now.
function accountHasConnectedMailbox(userData = {}, normalizedEmail = '') {
    const target = normalizeEmailAddress(normalizedEmail)
    if (!target) return false

    const connections = listEmailConnections(userData || {})
    if (connections.some(connection => normalizeEmailAddress(connection.emailAddress) === target)) return true

    const apisConnected = userData?.apisConnected || {}
    return Object.values(apisConnected).some(connection => {
        const resolved = resolveEmailConnection(connection || {})
        return resolved.connected && normalizeEmailAddress(resolved.emailAddress) === target
    })
}

// Kept under its original name because it is part of this module's published surface.
function hasActiveConnectedGmailEmail(userData = {}, normalizedEmail = '') {
    return accountHasConnectedMailbox(userData, normalizedEmail)
}

async function findAccountsWithConnectedMailbox(normalizedEmail) {
    let snapshot
    try {
        snapshot = await admin
            .firestore()
            .collectionGroup('private')
            .where('email', '==', normalizedEmail)
            .limit(CONNECTED_CREDENTIAL_SCAN_LIMIT)
            .get()
    } catch (error) {
        console.warn('Email Channel: Connected mailbox lookup failed', {
            error: error.message,
        })
        return []
    }

    if (snapshot.empty) return []

    if (snapshot.docs.length >= CONNECTED_CREDENTIAL_SCAN_LIMIT) {
        console.warn('Email Channel: Connected mailbox scan hit its limit and may be truncated', {
            limit: CONNECTED_CREDENTIAL_SCAN_LIMIT,
        })
    }

    const accountsById = new Map()

    for (const doc of snapshot.docs) {
        const data = doc.data() || {}

        // An allowlist, not a heuristic: `users/{uid}/private/**` is owner-writable, so a
        // hand-written document carrying `email` and `service: 'gmail'` would otherwise
        // present itself as a connection. Only the documents the OAuth handlers write are
        // considered, and only their mail halves.
        const credentialDocId = String(doc.id || '')
        const parsed = parseCredentialDocId(credentialDocId)
        if (!parsed) continue
        if (!MAIL_CREDENTIAL_SERVICES.has(String(data.service || '').trim())) continue

        const userRef = doc.ref?.parent?.parent
        const userId = String(userRef?.id || '').trim()
        if (!userId || accountsById.has(userId)) continue

        try {
            const userDoc = await userRef.get()
            if (!userDoc.exists) continue

            const userData = userDoc.data() || {}
            if (!accountHasConnectedMailbox(userData, normalizedEmail)) continue

            accountsById.set(userId, {
                uid: userId,
                userData,
                credentialDocId,
                provider: parsed.provider,
            })
        } catch (error) {
            console.warn('Email Channel: Failed resolving connected mailbox account for sender routing', {
                userId,
                error: error.message,
            })
        }
    }

    return Array.from(accountsById.values())
}

function rankCandidate(candidate) {
    const attestedMailbox = candidate.connected && candidate.connectionProof === PROOF_VERIFIED
    if (attestedMailbox && candidate.primaryVerified) return 1
    if (attestedMailbox) return 2
    if (candidate.primaryVerified) return 3
    if (candidate.connected) return 4
    return Number.MAX_SAFE_INTEGER
}

function describeCandidate(candidate) {
    return {
        userId: candidate.uid,
        primaryVerified: !!candidate.primaryVerified,
        connectedMailbox: !!candidate.connected,
        connectionProof: candidate.connectionProof || '',
        rank: rankCandidate(candidate),
    }
}

// Resolves an inbound sender address to at most one account, and says WHY when it cannot.
// Returns { status, user, candidates } where status is matched | unknown | ambiguous.
async function resolveEmailSenderIdentity(email) {
    const normalizedEmail = normalizeEmailAddress(email)
    if (!normalizedEmail) return { status: SENDER_STATUS_UNKNOWN, user: null, candidates: [] }

    const candidatesByUid = new Map()

    const primaryMatches = await findVerifiedUsersByPrimaryEmail(normalizedEmail)
    primaryMatches.forEach(user => {
        candidatesByUid.set(user.uid, {
            uid: user.uid,
            userData: user,
            primaryVerified: true,
            connected: false,
            connectionProof: '',
        })
    })

    const connectedMatches = await findAccountsWithConnectedMailbox(normalizedEmail)
    connectedMatches.forEach(match => {
        const existing = candidatesByUid.get(match.uid)
        if (existing) {
            existing.connected = true
            existing.credentialDocId = match.credentialDocId
            existing.provider = match.provider
            return
        }
        candidatesByUid.set(match.uid, {
            uid: match.uid,
            userData: { uid: match.uid, ...match.userData },
            primaryVerified: false,
            connected: true,
            connectionProof: '',
            credentialDocId: match.credentialDocId,
            provider: match.provider,
        })
    })

    if (candidatesByUid.size === 0) {
        return { status: SENDER_STATUS_UNKNOWN, user: null, candidates: [] }
    }

    const connectedCandidates = Array.from(candidatesByUid.values()).filter(candidate => candidate.connected)
    if (connectedCandidates.length > 0) {
        const attestedUserIds = await getAttestedUserIdsForEmail(normalizedEmail)
        for (const candidate of connectedCandidates) {
            candidate.connectionProof = await ensureEmailIdentityAttestation({
                userId: candidate.uid,
                email: normalizedEmail,
                provider: candidate.provider,
                credentialDocId: candidate.credentialDocId,
                attestedUserIds,
            })

            // The provider disowned these credentials. The claim is not merely unproven,
            // it is contradicted, so it stops counting as evidence at all.
            if (candidate.connectionProof === PROOF_REJECTED) {
                candidate.connected = false
                if (!candidate.primaryVerified) candidatesByUid.delete(candidate.uid)
            }
        }
    }

    const candidates = Array.from(candidatesByUid.values())
    if (candidates.length === 0) {
        return { status: SENDER_STATUS_UNKNOWN, user: null, candidates: [] }
    }

    const bestRank = Math.min(...candidates.map(rankCandidate))
    const winners = candidates.filter(candidate => rankCandidate(candidate) === bestRank)

    if (winners.length === 1) {
        return {
            status: SENDER_STATUS_MATCHED,
            user: winners[0].userData,
            candidates: candidates.map(describeCandidate),
        }
    }

    // Several accounts hold the same, equally strong claim. Guessing would deliver private
    // mail into the wrong workspace, so the sender is told instead.
    console.warn('Email Channel: Sender address belongs to several accounts', {
        candidates: candidates.map(describeCandidate),
    })

    return {
        status: SENDER_STATUS_AMBIGUOUS,
        user: null,
        candidates: candidates.map(describeCandidate),
    }
}

async function findVerifiedUserByEmailIdentity(email) {
    const { user } = await resolveEmailSenderIdentity(email)
    return user || null
}

async function getDefaultAssistantIdForUser(user, projectId) {
    const db = admin.firestore()
    const normalizedProjectId = String(projectId || '').trim()
    const userDefaultAssistantId = typeof user?.defaultAssistantId === 'string' ? user.defaultAssistantId.trim() : ''

    if (!normalizedProjectId) return null

    const assistantExistsInProjectOrGlobal = async assistantId => {
        if (!assistantId) return false
        const [projectAssistantDoc, globalAssistantDoc] = await db.getAll(
            db.doc(`assistants/${normalizedProjectId}/items/${assistantId}`),
            db.doc(`assistants/globalProject/items/${assistantId}`)
        )
        return projectAssistantDoc.exists || globalAssistantDoc.exists
    }

    try {
        const projectDoc = await db.doc(`projects/${normalizedProjectId}`).get()
        const projectAssistantId = projectDoc.exists ? String(projectDoc.data()?.assistantId || '').trim() : ''
        if (projectAssistantId && (await assistantExistsInProjectOrGlobal(projectAssistantId))) {
            return projectAssistantId
        }
    } catch (error) {
        console.warn('Email Channel: Could not resolve project assistant', { error: error.message })
    }

    if (userDefaultAssistantId) {
        try {
            if (await assistantExistsInProjectOrGlobal(userDefaultAssistantId)) {
                return userDefaultAssistantId
            }
        } catch (error) {
            console.warn('Email Channel: Could not validate user default assistant', { error: error.message })
        }
    }

    try {
        const snapshot = await db.collection(`assistants/${normalizedProjectId}/items`).limit(1).get()
        if (!snapshot.empty) return snapshot.docs[0].id
    } catch (error) {
        console.warn('Email Channel: Could not find assistant in project', { error: error.message })
    }

    try {
        const globalDefaultAssistant = await db.doc('assistants/globalProject').get()
        const defaultAssistant = globalDefaultAssistant.exists ? globalDefaultAssistant.data() : null
        return defaultAssistant?.uid || null
    } catch (error) {
        console.warn('Email Channel: Could not fetch global default assistant', { error: error.message })
    }

    return null
}

module.exports = {
    CONNECTED_CREDENTIAL_SCAN_LIMIT,
    SENDER_STATUS_AMBIGUOUS,
    SENDER_STATUS_MATCHED,
    SENDER_STATUS_UNKNOWN,
    accountHasConnectedMailbox,
    findVerifiedUserByEmailIdentity,
    getDefaultAssistantIdForUser,
    hasActiveConnectedGmailEmail,
    resolveEmailSenderIdentity,
}
