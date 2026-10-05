import { translate } from '../i18n/TranslationService'

// The task thread already supplies the task ID, project, title and description.
// Only include the calendar lookup hints missing from that contextual mechanism.
export const buildMeetingPreparationPrompt = ({ projectId, task }) => {
    if (!projectId || !task?.id || !task.calendarData) return ''

    const calendar = task.calendarData
    const start = calendar.start?.dateTime || calendar.start?.date
    const end = calendar.end?.dateTime || calendar.end?.date
    const context = [
        calendar.provider === 'microsoft' ? 'Outlook' : 'Google Calendar',
        calendar.eventId || calendar.id || task.id,
        calendar.calendarId,
        calendar.email,
        [start, end].filter(Boolean).join(' – '),
        calendar.start?.timeZone,
        calendar.originalProjectId && calendar.originalProjectId !== projectId
            ? translate('PrepareMeetingPromptSource', { projectId: calendar.originalProjectId })
            : null,
    ]
        .filter(Boolean)
        .join(' · ')

    return [
        translate('PrepareMeetingPromptSingle'),
        translate('PrepareMeetingPromptResearch'),
        translate('PrepareMeetingPromptScope'),
        translate('PrepareMeetingPromptContext', { context }),
    ].join('\n\n')
}
