import { isNextWorkflowStepAi } from '../../../WorkflowView/workflowStepHelper'

export const shouldShowAiStepControl = ({
    workflow,
    task,
    showWorkflowIndicator,
    pending,
    isObservedTask,
    isSuggested,
}) =>
    showWorkflowIndicator &&
    !pending &&
    !isObservedTask &&
    !isSuggested &&
    !task.genericData &&
    !task.calendarData &&
    !task.gmailData &&
    isNextWorkflowStepAi(workflow, task)
