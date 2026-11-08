import { confirmPreConfigTaskRun } from './preConfigTaskRunConfirmation'

// Security audit 2026-11: every place that runs a pre-configured task on the signed-in user's behalf
// asks this first. It lets content the user approved (or a curated global task) run straight away
// and shows anything else — prompt, system instruction, model — for confirmation. The store and the
// assistant helpers are required lazily: this sits on render paths of components whose tests mock
// react-redux, and nothing here is needed until a run is requested.
export function confirmAssistantTaskRunForCurrentUser(task, assistantId, contextProjectId) {
    const store = require('../redux/store').default
    const { getAssistantProjectId } = require('../components/AdminPanel/Assistants/assistantsHelper')
    const viewerId = store.getState().loggedUser?.uid
    const resolvedAssistantId = assistantId || task?.assistantId
    return confirmPreConfigTaskRun(task, viewerId, {
        assistantId: resolvedAssistantId,
        taskProjectId: resolvedAssistantId ? getAssistantProjectId(resolvedAssistantId, contextProjectId) : null,
    })
}
