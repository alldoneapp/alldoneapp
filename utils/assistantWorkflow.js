import { FEED_PUBLIC_FOR_ALL } from '../components/Feeds/Utils/FeedsConstants'
import { OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../components/TaskListView/Utils/TasksHelper'

export const ASSISTANT_WORKFLOW_FIRST_STEP_ID = 'assistant-start'
export const DEFAULT_ASSISTANT_WORKFLOW_PROMPT = 'Do this'

export const buildAssistantWorkflowFirstStep = (assistantId, addedById, now = Date.now()) => ({
    reviewerUid: assistantId,
    reviewerType: 'assistant',
    description: 'Execute task',
    addedById,
    date: now,
    sortIndex: 0,
    aiPreConfigTaskId: null,
    aiActionName: '',
    aiPrompt: DEFAULT_ASSISTANT_WORKFLOW_PROMPT,
    aiVariableValues: {},
})

export const getAssistantWorkflow = (assistant, projectId) => assistant?.workflow?.[projectId] || {}

export const getAssistantWorkflowFirstStep = (assistant, projectId) =>
    getAssistantWorkflow(assistant, projectId)[ASSISTANT_WORKFLOW_FIRST_STEP_ID] || null

export const assistantWorkflowFirstStepHasPrompt = (assistant, projectId) =>
    !!getAssistantWorkflowFirstStep(assistant, projectId)?.aiPrompt?.trim()

export const buildAssistantWorkflowTask = ({ assistant, projectId, creatorId, title, now = Date.now() }) => ({
    projectId,
    name: title.trim(),
    extendedName: title.trim(),
    userId: assistant.uid,
    userIds: [assistant.uid],
    currentReviewerId: assistant.uid,
    done: false,
    inDone: false,
    creatorId,
    assistantId: assistant.uid,
    assigneeType: TASK_ASSIGNEE_ASSISTANT_TYPE,
    workflowTask: true,
    workflowPayerUserId: creatorId,
    stepHistory: [ASSISTANT_WORKFLOW_FIRST_STEP_ID],
    completed: now,
    dueDate: now,
    estimations: {
        [OPEN_STEP]: 0,
        [ASSISTANT_WORKFLOW_FIRST_STEP_ID]: 0,
    },
    isPrivate: false,
    isPublicFor: [FEED_PUBLIC_FOR_ALL, creatorId, assistant.uid],
})
