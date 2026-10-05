import { resolveDefaultAssistantForProject } from '../components/AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../i18n/TranslationService'
import { createBotQuickTopic } from './assistantHelper'
import { buildMeetingPreparationPrompt } from './meetingPreparationPrompt'

// Shared by the section menu and both task-edit menus. The project override
// keeps routed events and global assistants from creating a chat in another project.
const pendingPreparations = new Set()

export const startMeetingPreparation = async ({ projectId, tasks, specificTask = false }) => {
    const prompt = buildMeetingPreparationPrompt({
        projectId,
        projectName: ProjectHelper.getProjectById(projectId)?.name,
        tasks,
        specificTask,
    })
    if (!prompt) return null

    const key = JSON.stringify([projectId, specificTask, tasks.map(task => task?.id).sort()])
    if (pendingPreparations.has(key)) return null
    pendingPreparations.add(key)
    try {
        const assistant = resolveDefaultAssistantForProject(projectId)
        if (!assistant?.uid) {
            alert(translate('No project assistant available'))
            return null
        }
        const chat = await createBotQuickTopic(assistant, prompt, {
            projectId,
            enableAssistant: true,
            skipNavigation: false,
        })
        if (!chat) throw new Error('Meeting preparation chat was not created')
        return chat
    } catch (error) {
        console.error('Could not start meeting preparation:', error)
        alert(translate('Meeting preparation could not start'))
        return null
    } finally {
        pendingPreparations.delete(key)
    }
}
