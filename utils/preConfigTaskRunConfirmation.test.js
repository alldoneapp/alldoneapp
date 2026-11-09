jest.mock('../i18n/TranslationService', () => ({
    translate: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
}))
jest.mock('./backends/Assistants/assistantTaskApproval', () => ({ approveAssistantTaskContent: jest.fn() }))

const {
    confirmPreConfigTaskRunFromLink,
    PROMPT_PREVIEW_MAX_LENGTH,
    viewerAuthoredPreConfigTask,
} = require('./preConfigTaskRunConfirmation')
const { computeAssistantTaskContentHash } = require('../functions/Assistant/assistantTaskContentHash')

const approvedFor = (task, userId) => ({
    ...task,
    approvedContentHashByUser: { [userId]: computeAssistantTaskContentHash(task) },
})

describe('confirming a pre-configured task run from a link (security audit 2026-11)', () => {
    it('runs content the viewer approved without asking', () => {
        const confirm = jest.fn()
        const task = approvedFor({ creatorUserId: 'me', prompt: 'x' }, 'me')
        expect(confirmPreConfigTaskRunFromLink(task, 'me', confirm, { taskProjectId: 'p1' })).toBe(true)
        expect(confirm).not.toHaveBeenCalled()
    })

    it('asks again when a member changed the viewer’s own task since they approved it', () => {
        const confirm = jest.fn(() => false)
        const task = { ...approvedFor({ creatorUserId: 'me', prompt: 'x' }, 'me'), aiSystemMessage: 'injected' }
        expect(confirmPreConfigTaskRunFromLink(task, 'me', confirm, { taskProjectId: 'p1' })).toBe(false)
        expect(confirm.mock.calls[0][0]).toContain('injected')
    })

    it('asks before running a prompt someone else wrote, and shows prompt, system instruction and model', () => {
        const confirm = jest.fn(() => false)
        expect(
            confirmPreConfigTaskRunFromLink(
                { creatorUserId: 'other', name: 'N', prompt: 'P1', aiSystemMessage: 'S1', aiModelOverride: 'MODEL_X' },
                'me',
                confirm
            )
        ).toBe(false)
        expect(confirmPreConfigTaskRunFromLink({ name: 'N', prompt: 'P2' }, 'me', confirm)).toBe(false)
        expect(confirm.mock.calls[0][0]).toContain('P1')
        expect(confirm.mock.calls[0][0]).toContain('S1')
        expect(confirm.mock.calls[0][0]).toContain('MODEL_X')
        expect(confirm.mock.calls[1][0]).toContain('P2')
        expect(confirm.mock.calls[1][0]).toContain('pre_config_task_run_confirm_model_default')
    })

    it('records the approval after a confirmed run', async () => {
        const { approveAssistantTaskContent } = require('./backends/Assistants/assistantTaskApproval')
        const task = { id: 't1', assistantId: 'a1', prompt: 'P' }
        expect(confirmPreConfigTaskRunFromLink(task, 'me', () => true, { taskProjectId: 'p1' })).toBe(true)
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(approveAssistantTaskContent).toHaveBeenCalledWith({
            projectId: 'p1',
            assistantId: 'a1',
            taskId: 't1',
            expectedHash: computeAssistantTaskContentHash(task),
        })
    })

    it('trims a very long prompt in the question', () => {
        const confirm = jest.fn(() => true)
        confirmPreConfigTaskRunFromLink({ prompt: 'a'.repeat(PROMPT_PREVIEW_MAX_LENGTH + 500) }, 'me', confirm)
        expect(confirm.mock.calls[0][0].length).toBeLessThan(PROMPT_PREVIEW_MAX_LENGTH + 400)
    })

    it('never treats a missing viewer as the author', () => {
        expect(viewerAuthoredPreConfigTask({ creatorUserId: undefined }, undefined)).toBe(false)
        expect(confirmPreConfigTaskRunFromLink({ prompt: 'x' }, undefined, null)).toBe(false)
    })
})
