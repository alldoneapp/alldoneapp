import { isNextWorkflowStepAi } from '../WorkflowView/workflowStepHelper'

export const getWorkflowCompletionCopy = (workflow, task, pending) => {
    if (pending) {
        return {
            title: 'Accept task?',
            subtitle: 'Select from the options below',
        }
    }

    if (isNextWorkflowStepAi(workflow, task)) {
        return {
            title: 'The assistant step is ready to run',
        }
    }

    return {
        title: 'Congrats, you have done it!',
        subtitle: 'Select from the options below',
    }
}
