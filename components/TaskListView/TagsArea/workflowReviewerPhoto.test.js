import { getWorkflowStepReviewerPhotoURL } from './workflowReviewerPhoto'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'

jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({ getUserPresentationData: jest.fn() }))

const PROJECT_ID = 'project-1'
const STEP_ID = 'step-1'

const owner = reviewerUid => ({ workflow: { [PROJECT_ID]: { [STEP_ID]: { reviewerUid } } } })

describe('getWorkflowStepReviewerPhotoURL', () => {
    beforeEach(() => {
        getUserPresentationData.mockReset()
        getUserPresentationData.mockReturnValue({ photoURL: 'https://example.com/photo.png' })
    })

    it('resolves the reviewer through the assistant-aware lookup', () => {
        expect(getWorkflowStepReviewerPhotoURL(owner('assistant-1'), PROJECT_ID, STEP_ID)).toBe(
            'https://example.com/photo.png'
        )
        expect(getUserPresentationData).toHaveBeenCalledWith('assistant-1')
    })

    it('returns no photo instead of throwing when the step cannot be resolved', () => {
        const cases = [
            [undefined, 'no task owner'],
            [{}, 'owner without a workflow'],
            [{ workflow: {} }, 'owner without a workflow in this project'],
            [{ workflow: { [PROJECT_ID]: {} } }, 'a step deleted from the workflow'],
            [owner(''), 'a step with no reviewer'],
        ]

        cases.forEach(([taskOwner]) => {
            expect(getWorkflowStepReviewerPhotoURL(taskOwner, PROJECT_ID, STEP_ID)).toBeUndefined()
        })
        expect(getUserPresentationData).not.toHaveBeenCalled()
    })
})
