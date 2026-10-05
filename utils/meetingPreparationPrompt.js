import { translate } from '../i18n/TranslationService'

// Calendar sync uses the provider event ID as the task document ID. Keep the
// occurrence's start/end and source account too: a title or series ID is not unique.
export const getMeetingContext = (projectId, task) => {
    const calendar = task.calendarData
    return {
        projectId,
        taskId: task.id,
        eventId: calendar.eventId || calendar.id || task.id,
        title: task.name || task.extendedName,
        description: task.description,
        provider: calendar.provider || 'google',
        calendarId: calendar.calendarId,
        accountEmail: calendar.email,
        sourceProjectId: calendar.originalProjectId,
        recurringEventId: calendar.recurringEventId,
        originalStartTime: calendar.originalStartTime,
        start: calendar.start,
        end: calendar.end,
        eventUrl: calendar.link || calendar.htmlLink,
        location: calendar.location || task.location,
        organizer: calendar.organizer,
        participants: calendar.attendees || calendar.participants || task.attendees,
    }
}

export const buildMeetingPreparationPrompt = ({ projectId, projectName, tasks, specificTask = false }) => {
    const uniqueTasks = Array.from(
        new Map(tasks.filter(task => task?.id && task.calendarData).map(task => [task.id, task])).values()
    )
    if (!projectId || uniqueTasks.length === 0) return ''

    return [
        translate(specificTask ? 'PrepareMeetingPromptSingle' : 'PrepareMeetingPromptSection'),
        translate('PrepareMeetingPromptResearch'),
        translate('PrepareMeetingPromptScope'),
        translate('PrepareMeetingPromptContext'),
        JSON.stringify(
            {
                projectId,
                projectName,
                meetingCount: uniqueTasks.length,
                meetings: uniqueTasks.map(task => getMeetingContext(projectId, task)),
            },
            null,
            2
        ),
    ].join('\n\n')
}
