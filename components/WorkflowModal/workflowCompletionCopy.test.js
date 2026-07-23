import { getWorkflowCompletionCopy } from './workflowCompletionCopy'

const workflow = {
    '2026-01': { description: 'Human review' },
    '2026-02': {
        description: 'Assistant review',
        reviewerType: 'assistant',
    },
}

describe('workflow completion copy', () => {
    test('announces the upcoming Assistant step after a human step', () => {
        expect(getWorkflowCompletionCopy(workflow, { done: false, stepHistory: [-1, '2026-01'] }, false)).toEqual({
            title: 'Your step is complete',
            subtitle: 'The Assistant step is ready to run',
        })
    })

    test('keeps the normal completion copy when the next step is human', () => {
        expect(getWorkflowCompletionCopy(workflow, { done: false, stepHistory: [-1] }, false)).toEqual({
            title: 'Congrats, you have done it!',
            subtitle: 'Select from the options below',
        })
    })

    test('keeps the pending-task copy even if an Assistant step follows', () => {
        expect(getWorkflowCompletionCopy(workflow, { done: false, stepHistory: [-1, '2026-01'] }, true)).toEqual({
            title: 'Accept task?',
            subtitle: 'Select from the options below',
        })
    })
})
