'use strict'

// Who a heartbeat may run as (security audit NV-17).
//
// A heartbeat runs unattended AS a project member: with their identity, their Gold and their
// connected accounts (search_gmail reads that member's mailbox). Its prompt, tools and instructions
// live on the shared assistant document, which every project member may edit. So one member could
// configure a prompt that runs as every other member. A heartbeat therefore runs for a member only
// when that member confirmed it:
//
//   - users/{uid}.heartbeatOptIns["<projectId>__<assistantId>"] = { configHash, confirmedAt },
//     written by the assistantHeartbeatOptIn callable for the signed-in member only. configHash
//     binds the confirmation to what runs as them (prompt, tools, instructions, MCP servers). When
//     anybody changes one of those, the hash no longer matches and the heartbeat stops for that
//     member until they confirm the new configuration;
//   - the server confirms on behalf of a project's ONLY member, at the moment the configuration is
//     created or changed (stampSoleMemberHeartbeatConfirmations, from the assistant and project
//     triggers): nobody else can have written it then. Personal projects keep their heartbeat
//     without anybody clicking anything. This is deliberately not "a sole member is always
//     trusted": a member who changes the prompt and then leaves would otherwise have it run as the
//     member left behind. A change made while the project was shared stays unconfirmed.
//
// Chance, interval, awake window, model and WhatsApp delivery are not part of the hash: they decide
// when and where the member's own confirmed heartbeat runs, not what it does.

const crypto = require('crypto')
const { getEffectiveHeartbeatPrompt } = require('./heartbeatSettingsHelper')

const HEARTBEAT_OPT_INS_FIELD = 'heartbeatOptIns'
const GLOBAL_PROJECT_ID = 'globalProject'
const HEARTBEAT_CONFIG_FIELDS = ['heartbeatPrompt', 'allowedTools', 'instructions', 'mcpServers']

function getHeartbeatOptInKey(projectId, assistantId) {
    return `${projectId}__${assistantId}`
}

function normalizeMcpServers(servers) {
    if (!Array.isArray(servers)) return []
    return servers
        .filter(server => server && typeof server === 'object')
        .map(server => ({
            id: String(server.id || server.serverId || ''),
            url: String(server.url || ''),
            enabled: server.enabled !== false,
        }))
        .sort((a, b) => `${a.id}|${a.url}`.localeCompare(`${b.id}|${b.url}`))
}

function getHeartbeatConfigHash(assistant = {}) {
    const allowedTools = Array.isArray(assistant.allowedTools)
        ? [...new Set(assistant.allowedTools.filter(tool => typeof tool === 'string'))].sort()
        : []
    const payload = {
        prompt: getEffectiveHeartbeatPrompt(assistant),
        allowedTools,
        instructions: typeof assistant.instructions === 'string' ? assistant.instructions : '',
        mcpServers: normalizeMcpServers(assistant.mcpServers),
    }
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function getUniqueMemberIds(project) {
    return Array.isArray(project?.userIds) ? [...new Set(project.userIds.filter(Boolean))] : []
}

function getSoleMemberId(project) {
    const memberIds = getUniqueMemberIds(project)
    return memberIds.length === 1 ? memberIds[0] : null
}

// 'confirmed' | 'stale' (confirmed an older configuration) | 'none'
function getHeartbeatOptInState({ projectId, assistant, userId, userData }) {
    if (!userId || !assistant?.uid) return 'none'
    const record = userData?.[HEARTBEAT_OPT_INS_FIELD]?.[getHeartbeatOptInKey(projectId, assistant.uid)]
    if (!record || typeof record.configHash !== 'string') return 'none'
    return record.configHash === getHeartbeatConfigHash(assistant) ? 'confirmed' : 'stale'
}

function isHeartbeatAuthorizedForMember(args) {
    return getHeartbeatOptInState(args) === 'confirmed'
}

// Confirms the current configuration of `assistants` for the project's only member, if it has
// exactly one. Called when an assistant is created or its heartbeat configuration changes, and when
// a project is created; at those moments the only member is the only person who can have written
// the configuration. Never throws into the trigger that calls it.
async function stampSoleMemberHeartbeatConfirmations({ db, projectId, project, assistants = [], now = Date.now() }) {
    try {
        const userId = getSoleMemberId(project)
        if (!userId || !assistants.length) return 0
        const userDoc = await db.doc(`users/${userId}`).get()
        if (!userDoc.exists) return 0
        const records = userDoc.data()?.[HEARTBEAT_OPT_INS_FIELD] || {}
        const update = {}
        assistants
            .filter(assistant => assistant?.uid)
            .forEach(assistant => {
                const key = getHeartbeatOptInKey(projectId, assistant.uid)
                const configHash = getHeartbeatConfigHash(assistant)
                if (records[key]?.configHash === configHash) return
                update[`${HEARTBEAT_OPT_INS_FIELD}.${key}`] = {
                    configHash,
                    confirmedAt: now,
                    confirmedBy: 'sole_member',
                }
            })
        if (!Object.keys(update).length) return 0
        await db.doc(`users/${userId}`).update(update)
        return Object.keys(update).length
    } catch (error) {
        console.error('Heartbeat: could not confirm the sole member’s heartbeat', { projectId, error: error.message })
        return 0
    }
}

// Trigger entry point: loads what stampSoleMemberHeartbeatConfirmations needs. `assistantId`
// limits it to one assistant; without it every assistant of the project is covered.
async function confirmHeartbeatsForSoleMember({ db, projectId, assistantId = null, project = null, now = Date.now() }) {
    try {
        if (!projectId || projectId === GLOBAL_PROJECT_ID) return 0
        const projectData =
            project ||
            (await db
                .doc(`projects/${projectId}`)
                .get()
                .then(doc => (doc.exists ? doc.data() : null)))
        if (!getSoleMemberId(projectData)) return 0
        const assistants = assistantId
            ? await db
                  .doc(`assistants/${projectId}/items/${assistantId}`)
                  .get()
                  .then(doc => (doc.exists ? [{ ...doc.data(), uid: assistantId }] : []))
            : await db
                  .collection(`assistants/${projectId}/items`)
                  .get()
                  .then(snapshot => snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id })))
        return await stampSoleMemberHeartbeatConfirmations({ db, projectId, project: projectData, assistants, now })
    } catch (error) {
        console.error('Heartbeat: could not confirm the sole member’s heartbeat', { projectId, error: error.message })
        return 0
    }
}

const OPT_IN_ACTIONS = ['get', 'confirm', 'revoke', 'refresh']

function isValidId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

// The callable behind the heartbeat row in the assistant settings. It reads and writes only the
// signed-in member's own record, and computes the hash itself, so a confirmation always binds to
// the configuration as it is stored right now.
//   get     -> the member's state
//   confirm -> confirm the current configuration (also re-confirms a stale one)
//   revoke  -> stop the heartbeat for this member
//   refresh -> re-confirm only if the member had confirmed before; the client calls it after the
//              member changed the assistant themselves, so their own edit does not stop their
//              heartbeat. Another member's edit still does.
async function handleHeartbeatOptInRequest({ db, userId, data, fieldValue, now = Date.now() }) {
    const projectId = data?.projectId
    const assistantId = data?.assistantId
    const action = data?.action || 'get'
    if (!userId) return { success: false, error: 'Authentication required' }
    if (!OPT_IN_ACTIONS.includes(action)) return { success: false, error: 'Unknown action' }
    if (!isValidId(projectId) || !isValidId(assistantId) || projectId === GLOBAL_PROJECT_ID) {
        return { success: false, error: 'A project assistant is required' }
    }

    const [projectDoc, assistantDoc, userDoc] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.doc(`assistants/${projectId}/items/${assistantId}`).get(),
        db.doc(`users/${userId}`).get(),
    ])
    const project = projectDoc.exists ? projectDoc.data() || {} : null
    if (!project || !getUniqueMemberIds(project).includes(userId)) {
        return { success: false, error: 'You are not a member of this project' }
    }
    if (!assistantDoc.exists) return { success: false, error: 'Assistant not found' }
    const assistant = { ...assistantDoc.data(), uid: assistantId }
    let userData = userDoc.exists ? userDoc.data() || {} : {}
    const key = getHeartbeatOptInKey(projectId, assistantId)
    const fieldPath = `${HEARTBEAT_OPT_INS_FIELD}.${key}`
    const hadRecord = !!userData?.[HEARTBEAT_OPT_INS_FIELD]?.[key]

    if (action === 'revoke') {
        if (hadRecord) await db.doc(`users/${userId}`).update({ [fieldPath]: fieldValue.delete() })
        const { [key]: removed, ...rest } = userData[HEARTBEAT_OPT_INS_FIELD] || {}
        userData = { ...userData, [HEARTBEAT_OPT_INS_FIELD]: rest }
    } else if (action === 'confirm' || (action === 'refresh' && hadRecord)) {
        const record = { configHash: getHeartbeatConfigHash(assistant), confirmedAt: now }
        await db.doc(`users/${userId}`).update({ [fieldPath]: record })
        userData = {
            ...userData,
            [HEARTBEAT_OPT_INS_FIELD]: { ...(userData[HEARTBEAT_OPT_INS_FIELD] || {}), [key]: record },
        }
    }

    return {
        success: true,
        state: getHeartbeatOptInState({ projectId, assistant, userId, userData }),
        confirmed: !!userData?.[HEARTBEAT_OPT_INS_FIELD]?.[key],
    }
}

module.exports = {
    handleHeartbeatOptInRequest,
    HEARTBEAT_OPT_INS_FIELD,
    HEARTBEAT_CONFIG_FIELDS,
    getHeartbeatOptInKey,
    getHeartbeatConfigHash,
    getHeartbeatOptInState,
    isHeartbeatAuthorizedForMember,
    stampSoleMemberHeartbeatConfirmations,
    confirmHeartbeatsForSoleMember,
}
