const mockRun = jest.fn(async () => ({ approved: true }))
jest.mock('../firestore', () => ({ runHttpsCallableFunction: (...args) => mockRun(...args) }))

const { stripServerOwnedAssistantTaskFields, approveAssistantTaskContentAsShown } = require('./assistantTaskApproval')
const { computeAssistantTaskContentHash } = require('../../../functions/Assistant/assistantTaskContentHash')

describe('assistant task approvals from the client (security audit 2026-11, NEW-A)', () => {
    it('never writes the server-owned approval fields back, even from a loaded copy', () => {
        const loaded = {
            prompt: 'p',
            approvedContentHashByUser: { ann: 'h' },
            contentApprovalNoticeByUser: { ann: 'h' },
        }
        expect(stripServerOwnedAssistantTaskFields(loaded)).toEqual({ prompt: 'p' })
        expect(loaded.approvedContentHashByUser).toEqual({ ann: 'h' })
    })

    it('asks the server to approve exactly the content that was shown', async () => {
        const task = { id: 't', prompt: 'p', aiSystemMessage: 's' }
        await approveAssistantTaskContentAsShown({ projectId: 'p1', assistantId: 'a1', task })
        expect(mockRun).toHaveBeenCalledWith('approveAssistantTaskContentSecondGen', {
            projectId: 'p1',
            assistantId: 'a1',
            taskId: 't',
            expectedHash: computeAssistantTaskContentHash(task),
        })
    })
})
