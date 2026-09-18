import { getDb } from '../firestore'
import { setGoalFocusArea, resolveFocusAreaForProjectMove } from './goalFocusAreas'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: 'editor' } }) }))

describe('saving goal focus areas', () => {
    let transaction
    let db
    beforeEach(() => {
        transaction = {
            get: jest.fn().mockResolvedValue({ data: () => ({ focusAreas: { marketing: { name: 'Marketing' } } }) }),
            update: jest.fn(),
        }
        db = { doc: path => ({ path }), runTransaction: callback => callback(transaction) }
        getDb.mockReturnValue(db)
    })

    test('sets one valid area and audit metadata without replacing unrelated goal fields', async () => {
        await setGoalFocusArea('p', 'g', 'marketing')
        expect(transaction.update).toHaveBeenCalledWith(
            { path: 'goals/p/items/g' },
            {
                focusAreaId: 'marketing',
                lastEditionDate: expect.any(Number),
                lastEditorId: 'editor',
            }
        )
    })

    test('refuses an area that is absent from this project', async () => {
        await expect(setGoalFocusArea('p', 'g', 'different-project-area')).rejects.toThrow('focus-area-not-found')
        expect(transaction.update).not.toHaveBeenCalled()
    })

    test('clearing writes null without fetching a catalog or touching other goals', async () => {
        await setGoalFocusArea('p', 'g', null)
        expect(transaction.get).not.toHaveBeenCalled()
        expect(transaction.update).toHaveBeenCalledTimes(1)
        expect(transaction.update.mock.calls[0][1].focusAreaId).toBeNull()
    })

    test('moving an unassigned goal does not create a project catalog entry', async () => {
        expect(await resolveFocusAreaForProjectMove('a', 'b', {})).toBeNull()
        expect(transaction.update).not.toHaveBeenCalled()
    })
})
