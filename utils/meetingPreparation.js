import { resolveDefaultAssistantForProject } from '../components/AdminPanel/Assistants/assistantsHelper'
import { STAYWARD_COMMENT } from '../components/Feeds/Utils/HelperFunctions'
import { translate } from '../i18n/TranslationService'
import { createObjectMessage } from './backends/Chats/chatsComments'
import { buildMeetingPreparationPrompt } from './meetingPreparationPrompt'

// Shared across section/task menus, including overlapping bulk and single requests.
// Keep each destination reserved until its queued message's assistant run settles.
const pendingPreparations = new Set()

export const startMeetingPreparation = async ({ projectId, tasks = [] }) => {
    if (!projectId) return null
    const meetings = Array.from(
        new Map(tasks.filter(task => task?.id && task.calendarData).map(task => [task.id, task])).values()
    ).filter(task => !pendingPreparations.has(JSON.stringify([projectId, task.id])))
    if (!meetings.length) return null

    const assistant = resolveDefaultAssistantForProject(projectId)
    if (!assistant?.uid) {
        alert(translate('No project assistant available'))
        return null
    }

    // Reserve the entire selection before yielding so another menu cannot submit
    // one of the later meetings while this bulk request is still being queued.
    const keys = meetings.map(task => JSON.stringify([projectId, task.id]))
    keys.forEach(key => pendingPreparations.add(key))
    const messageIds = []
    let failed = false
    for (const [index, task] of meetings.entries()) {
        const release = () => pendingPreparations.delete(keys[index])
        try {
            const messageId = await createObjectMessage(
                projectId,
                task.id,
                buildMeetingPreparationPrompt({ projectId, task }),
                'tasks',
                STAYWARD_COMMENT,
                null,
                null,
                false,
                true,
                assistant.uid,
                release
            )
            if (!messageId) throw new Error('Meeting preparation message was not queued')
            messageIds.push(messageId)
        } catch (error) {
            release()
            failed = true
            console.error('Could not start meeting preparation:', error)
        }
    }
    if (failed) alert(translate('Meeting preparation could not start'))
    return messageIds.length ? messageIds : null
}
