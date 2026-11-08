import { bindCopiedTaskIdentityFieldsToWriter } from './taskIdentityFields'

describe('bindCopiedTaskIdentityFieldsToWriter (security audit 2026-11)', () => {
    it("re-attributes a copied task that looks like another user's own work", () => {
        const copy = bindCopiedTaskIdentityFieldsToWriter({ creatorId: 'ann', lastEditorId: 'ann' }, 'bob')

        expect(copy).toMatchObject({ creatorId: 'ann', lastEditorId: 'bob' })
    })

    it("leaves the writer's own task untouched", () => {
        const task = {
            creatorId: 'bob',
            lastEditorId: 'bob',
            workflowPayerUserId: 'bob',
            workflowAiPromptOverride: { stepId: 's1', prompt: 'Go', requestedByUserId: 'bob' },
            calendarData: { projectRoutingFeedback: { requestedByUserId: 'bob' } },
        }

        expect(bindCopiedTaskIdentityFieldsToWriter(task, 'bob')).toEqual(task)
    })

    it('makes the copier the payer and drops a prompt override written by somebody else', () => {
        const copy = bindCopiedTaskIdentityFieldsToWriter(
            {
                workflowTask: true,
                workflowPayerUserId: 'ann',
                workflowAiPromptOverride: { stepId: 's1', prompt: 'Go', requestedByUserId: 'ann' },
            },
            'bob'
        )

        expect(copy.workflowPayerUserId).toBe('bob')
        expect(copy.workflowAiPromptOverride).toBeNull()
    })

    it('strips calendar routing feedback written by somebody else and keeps the rest', () => {
        const copy = bindCopiedTaskIdentityFieldsToWriter(
            {
                calendarData: {
                    eventId: 'e1',
                    projectRoutingFeedback: { requestedByUserId: 'bob', feedbackId: 'new' },
                    goalRoutingFeedback: { requestedByUserId: 'ann', feedbackId: 'old' },
                },
            },
            'bob'
        )

        expect(copy.calendarData).toEqual({
            eventId: 'e1',
            projectRoutingFeedback: { requestedByUserId: 'bob', feedbackId: 'new' },
        })
    })
})
