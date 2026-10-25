import { addProtocol } from './LinkingHelper'
import { getPreConfigTask, getPreConfigTasksForProject } from './backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../components/AdminPanel/Assistants/assistantsHelper'

// A mention keeps the task and assistant IDs it had when it was inserted. Assistants can
// later be replaced, so a link may outlive both documents while the task still exists.
export async function resolvePreConfigTaskLink(link, contextProjectId) {
    const url = new URL(addProtocol(link))
    const pathParts = url.pathname.split('/')
    const tasksIndex = pathParts.indexOf('preConfigTasks')
    const linkProjectId = tasksIndex > 1 && pathParts[tasksIndex - 2] === 'projects' && pathParts[tasksIndex - 1]
    const taskId = tasksIndex >= 0 && pathParts[tasksIndex + 1]
    const assistantId = url.searchParams.get('assistantId')
    const assistantProjectId = url.searchParams.get('assistantProjectId') || linkProjectId

    if (!linkProjectId || !taskId || !assistantId || !assistantProjectId) return null

    const targetProjectId = contextProjectId || linkProjectId
    const task = await getPreConfigTask(assistantProjectId, assistantId, taskId)
    if (task) return { task, assistantId, assistantProjectId, targetProjectId }

    const name = url.searchParams.get('name')
    if (!name) return null

    // Search only assistants available to the member in the linked project. A name is
    // useful for repairing an old mention only when it identifies exactly one task.
    const candidates = (await getPreConfigTasksForProject(linkProjectId)).filter(candidate => candidate.name === name)
    if (candidates.length !== 1) return null

    const replacement = candidates[0]
    const replacementProjectId = isGlobalAssistant(replacement.assistantId) ? GLOBAL_PROJECT_ID : linkProjectId
    const currentTask = await getPreConfigTask(replacementProjectId, replacement.assistantId, replacement.id)
    if (!currentTask || currentTask.name !== name) return null

    return {
        task: currentTask,
        assistantId: replacement.assistantId,
        assistantProjectId: replacementProjectId,
        targetProjectId,
    }
}
