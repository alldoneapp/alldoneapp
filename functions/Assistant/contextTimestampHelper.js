const moment = require('moment')
const { TaskRetrievalService } = require('../shared/TaskRetrievalService')

function normalizeContextTimezoneOffset(userTimezoneOffset = null) {
    const normalized = TaskRetrievalService.normalizeTimezoneOffset(userTimezoneOffset)
    return typeof normalized === 'number' ? normalized : null
}

function resolveUserTimezoneOffset(userData = {}) {
    const candidates = [
        userData?.timezone,
        userData?.timezoneOffset,
        userData?.timezoneMinutes,
        userData?.preferredTimezone,
    ]

    for (const candidate of candidates) {
        const normalized = normalizeContextTimezoneOffset(candidate)
        if (normalized !== null) return normalized
    }

    return null
}

function getUserLocalDateContext(userData = {}, timestamp = Date.now()) {
    const normalizedOffset = normalizeContextTimezoneOffset(resolveUserTimezoneOffset(userData))
    const momentValue =
        normalizedOffset !== null ? moment.utc(timestamp).utcOffset(normalizedOffset) : moment.utc(timestamp)

    return {
        dateKey: momentValue.format('YYYYMMDD'),
        dateLabel: momentValue.format('DD MMM YYYY'),
        timezoneOffsetMinutes: normalizedOffset,
    }
}

function formatUserTimezoneLabel(userTimezoneOffset = null) {
    const normalizedOffset = normalizeContextTimezoneOffset(userTimezoneOffset)
    if (normalizedOffset === null) return 'UTC'

    const hours = Math.floor(Math.abs(normalizedOffset) / 60)
    const minutes = Math.abs(normalizedOffset) % 60
    const sign = normalizedOffset >= 0 ? '+' : '-'
    return minutes > 0 ? `UTC${sign}${hours}:${minutes.toString().padStart(2, '0')}` : `UTC${sign}${hours}`
}

function formatContextMessageTimestamp(timestamp, userTimezoneOffset = null) {
    const numericTimestamp = Number(timestamp || 0)
    if (!numericTimestamp) return 'Unknown time'
    const normalizedOffset = normalizeContextTimezoneOffset(userTimezoneOffset)

    const momentValue =
        normalizedOffset !== null ? moment(numericTimestamp).utcOffset(normalizedOffset) : moment.utc(numericTimestamp)

    return `${momentValue.format('YYYY-MM-DD HH:mm:ss')} ${formatUserTimezoneLabel(userTimezoneOffset)}`
}

function addTimestampToContextContent(content, timestamp, userTimezoneOffset = null) {
    const prefix = `[Sent at ${formatContextMessageTimestamp(timestamp, userTimezoneOffset)}]`

    if (typeof content === 'string') {
        return `${prefix}\n${content || ''}`.trim()
    }

    if (Array.isArray(content)) {
        const clonedContent = content.map(part => {
            if (!part || typeof part !== 'object') return part
            if (part.type === 'image_url' && part.image_url) {
                return {
                    ...part,
                    image_url: { ...part.image_url },
                }
            }
            return { ...part }
        })

        const textPartIndex = clonedContent.findIndex(part => part?.type === 'text')
        if (textPartIndex >= 0) {
            const currentText = clonedContent[textPartIndex]?.text || ''
            clonedContent[textPartIndex] = {
                ...clonedContent[textPartIndex],
                text: `${prefix}\n${currentText}`.trim(),
            }
        } else {
            clonedContent.unshift({ type: 'text', text: prefix })
        }

        return clonedContent
    }

    return `${prefix}\n${String(content || '')}`.trim()
}

module.exports = {
    addTimestampToContextContent,
    formatContextMessageTimestamp,
    normalizeContextTimezoneOffset,
    resolveUserTimezoneOffset,
    getUserLocalDateContext,
}
