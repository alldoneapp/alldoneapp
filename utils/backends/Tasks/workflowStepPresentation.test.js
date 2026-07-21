jest.mock('../../../i18n/TranslationService', () => ({ translate: value => value }))

import { getWorkflowStepPresentation } from './workflowStepPresentation'

const workflow = {
    'step-1': { description: 'Design', reviewerUid: 'user-1' },
    'step-2': { description: 'Review', reviewerUid: 'user-2' },
}

describe('getWorkflowStepPresentation', () => {
    it('reads the description and reviewer of a step that is still in the workflow', () => {
        expect(getWorkflowStepPresentation(workflow, 'step-2')).toEqual({
            description: 'Review',
            reviewerUid: 'user-2',
        })
    })

    it('falls back to a translated label when the step was deleted from the workflow', () => {
        // The task still references the step, so before this fallback the destructure threw and
        // took the whole feed batch for the task move down with it.
        expect(getWorkflowStepPresentation(workflow, 'deleted-step')).toEqual({
            description: 'Unknown step',
            reviewerUid: '',
        })
    })

    it('falls back for an owner with no workflow in this project', () => {
        // getTaskOwner also resolves workstreams and assistants, neither of which has a workflow.
        expect(getWorkflowStepPresentation(undefined, 'step-1').description).toBe('Unknown step')
        expect(getWorkflowStepPresentation(null, 'step-1').description).toBe('Unknown step')
        expect(getWorkflowStepPresentation({}, 'step-1').description).toBe('Unknown step')
    })

    it('never returns undefined fields, so Firestore cannot reject the feed write', () => {
        const cases = [
            getWorkflowStepPresentation(workflow, 'deleted-step'),
            getWorkflowStepPresentation({ 'step-1': {} }, 'step-1'),
            getWorkflowStepPresentation({ 'step-1': { description: 'Design' } }, 'step-1'),
            getWorkflowStepPresentation({ 'step-1': { reviewerUid: 'user-1' } }, 'step-1'),
        ]

        cases.forEach(({ description, reviewerUid }) => {
            expect(typeof description).toBe('string')
            expect(typeof reviewerUid).toBe('string')
        })
    })

    it('keeps a half-written step usable instead of discarding the field it does have', () => {
        expect(getWorkflowStepPresentation({ 'step-1': { description: 'Design' } }, 'step-1')).toEqual({
            description: 'Design',
            reviewerUid: '',
        })
        expect(getWorkflowStepPresentation({ 'step-1': { reviewerUid: 'user-1' } }, 'step-1')).toEqual({
            description: 'Unknown step',
            reviewerUid: 'user-1',
        })
    })
})
