import { shouldShowAiStepControl } from './taskAiStepControl'

const aiWorkflow = {
    '2026-01': { description: 'AI draft', reviewerType: 'assistant' },
}

const baseTask = {
    done: false,
    genericData: null,
    calendarData: null,
    gmailData: null,
    stepHistory: [-1],
}

const getArgs = task => ({
    workflow: aiWorkflow,
    task,
    showWorkflowIndicator: true,
    pending: false,
    isObservedTask: false,
    isSuggested: false,
})

describe('AI workflow step task control', () => {
    test('shows the play control for a regular task whose next workflow step is AI', () => {
        expect(shouldShowAiStepControl(getArgs(baseTask))).toBe(true)
    })

    test('keeps the email-task control when the next standard workflow step is AI', () => {
        const emailTask = {
            ...baseTask,
            gmailData: {
                origin: 'gmail_label_follow_up',
                connectionId: 'email_google_12345678',
                messageId: 'message-1',
            },
        }

        expect(shouldShowAiStepControl(getArgs(emailTask))).toBe(false)
    })
})
