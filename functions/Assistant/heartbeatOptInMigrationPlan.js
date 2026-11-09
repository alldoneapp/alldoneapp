'use strict'

// Which members the one-time NV-17 migration confirms (migration/confirmAssistantHeartbeats.js).
// Before NV-17 a heartbeat ran as every active member of the project whenever the assistant's chance
// was above zero. Afterwards it runs only for members who confirmed it (heartbeatOptIn.js). The
// migration confirms, with the assistant's CURRENT configuration:
//   scope 'owner' (default): the only member of a one-member project, and in a shared project the
//                            assistant's creator, when they are still a member;
//   scope 'all': every member a heartbeat effectively reaches today.
// An existing record is never touched.

const { HEARTBEAT_OPT_INS_FIELD, getHeartbeatConfigHash, getHeartbeatOptInKey } = require('./heartbeatOptIn')
const { isAssistantHeartbeatEligible, isProjectHeartbeatEligible } = require('./assistantHeartbeatSchedule')

const MIGRATION_SCOPES = ['owner', 'all']

function planHeartbeatConfirmations({
    projectId,
    project,
    assistants = [],
    usersById = new Map(),
    scope = 'owner',
    now,
}) {
    if (!MIGRATION_SCOPES.includes(scope)) throw new Error(`Unknown scope ${scope}`)
    if (!project || !isProjectHeartbeatEligible(project)) return []
    const memberIds = Array.isArray(project.userIds) ? [...new Set(project.userIds.filter(Boolean))] : []
    const plan = []

    assistants.forEach(assistant => {
        if (!assistant?.uid) return
        const key = getHeartbeatOptInKey(projectId, assistant.uid)
        const candidates =
            scope === 'all' || memberIds.length === 1 ? memberIds : memberIds.filter(id => id === assistant.creatorId)
        candidates.forEach(userId => {
            const userData = usersById.get(userId)
            if (!userData) return
            if (userData[HEARTBEAT_OPT_INS_FIELD]?.[key]) return
            if (!isAssistantHeartbeatEligible(assistant, projectId, userData)) return
            plan.push({
                userId,
                projectId,
                assistantId: assistant.uid,
                fieldPath: `${HEARTBEAT_OPT_INS_FIELD}.${key}`,
                record: { configHash: getHeartbeatConfigHash(assistant), confirmedAt: now, confirmedBy: 'migration' },
            })
        })
    })
    return plan
}

module.exports = { MIGRATION_SCOPES, planHeartbeatConfirmations }
