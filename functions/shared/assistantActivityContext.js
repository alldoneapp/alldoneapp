const ACTIVITY_CONTEXT_LIMIT = 50
const ACTIVITY_CONTEXT_MAX_CHARS = 24000
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const text = (value, max) =>
    typeof value === 'string'
        ? value
              .replace(/[\x00-\x1f\x7f]/g, ' ')
              .trim()
              .slice(0, max)
        : ''

function normalizeAssistantActivityNotice(notice, userId) {
    if (!notice || !validId(userId) || notice.userId !== userId || !['feed', 'chat'].includes(notice.kind)) return null
    const parts = typeof notice.id === 'string' ? notice.id.split('/') : []
    if (parts[0] !== notice.kind || parts.length !== (notice.kind === 'feed' ? 5 : 4) || !parts.slice(1).every(validId))
        return null
    if (parts[1] !== notice.sourceProjectId || !validId(notice.projectId) || !validId(notice.chatId)) return null
    if (!Number.isFinite(notice.created) || notice.created <= 0) return null
    const result = {
        id: notice.id,
        userId,
        kind: notice.kind,
        sourceProjectId: notice.sourceProjectId,
        projectId: notice.projectId,
        chatId: notice.chatId,
        created: notice.created,
        occurredAt: Number.isFinite(notice.occurredAt) ? notice.occurredAt : notice.created,
        path: `/projects/${notice.sourceProjectId}/user/${userId}/${notice.kind === 'feed' ? 'updates' : 'chats'}/followed`,
        projectName: text(notice.projectName, 160),
        entryText: text(notice.entryText, 240),
    }
    if (notice.content && typeof notice.content === 'object') {
        result.content = {
            label: text(notice.content.label, 480),
            objectName: text(notice.content.objectName, 240),
            actorName: text(notice.content.actorName, 240),
            preview: text(notice.content.preview, 240),
        }
    }
    return result
}

module.exports = { ACTIVITY_CONTEXT_LIMIT, ACTIVITY_CONTEXT_MAX_CHARS, normalizeAssistantActivityNotice }
