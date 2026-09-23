'use strict'

function filterPrivacyForTarget(isPublicFor, targetUserIds, actorId) {
    if (Array.isArray(isPublicFor) && isPublicFor.includes(0)) return [0]
    const targetMembers = new Set(targetUserIds || [])
    const filtered = (Array.isArray(isPublicFor) ? isPublicFor : []).filter(
        id => targetMembers.has(id) || String(id).startsWith('ws@')
    )
    if (targetMembers.has(actorId) && !filtered.includes(actorId)) filtered.push(actorId)
    return filtered
}

module.exports = { filterPrivacyForTarget }
