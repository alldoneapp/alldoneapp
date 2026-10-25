import { queueObjectProjectMove, waitForProjectMoveCompletion } from './projectMoves'
import { isLocalContactMovePending } from '../projectMoveState'
import { getDb, runHttpsCallableFunction } from './firestore'

jest.mock('./firestore', () => ({
    getDb: jest.fn(),
    runHttpsCallableFunction: jest.fn(),
}))

const SOURCE = 'source'
const TARGET = 'target'
const CONTACT = 'contact'

describe('contact move indicator lifecycle', () => {
    afterEach(() => {
        jest.clearAllMocks()
    })

    it('appears before the callable settles and clears after target completion', async () => {
        let acceptMove
        runHttpsCallableFunction.mockImplementation(() => new Promise(resolve => (acceptMove = resolve)))
        const queued = queueObjectProjectMove(SOURCE, TARGET, 'contact', CONTACT)
        expect(isLocalContactMovePending(SOURCE, CONTACT)).toBe(true)
        acceptMove({ queued: true })
        await queued
        expect(isLocalContactMovePending(SOURCE, CONTACT)).toBe(true)

        getDb.mockReturnValue({
            doc: path => ({
                get: () =>
                    Promise.resolve(
                        path.includes(`/${TARGET}/`)
                            ? { exists: true, data: () => ({ projectMove: { status: 'completed' } }) }
                            : { exists: false, data: () => undefined }
                    ),
            }),
        })
        await expect(waitForProjectMoveCompletion(SOURCE, TARGET, 'contact', CONTACT)).resolves.toMatchObject({
            id: CONTACT,
        })
        expect(isLocalContactMovePending(SOURCE, CONTACT)).toBe(false)
    })

    it('clears the local indicator when enqueue is rejected', async () => {
        runHttpsCallableFunction.mockRejectedValue(new Error('permission denied'))
        await expect(queueObjectProjectMove(SOURCE, TARGET, 'contact', CONTACT)).rejects.toThrow('permission denied')
        expect(isLocalContactMovePending(SOURCE, CONTACT)).toBe(false)
    })

    it('clears the local indicator when the worker reports failure', async () => {
        runHttpsCallableFunction.mockResolvedValue({ queued: true })
        await queueObjectProjectMove(SOURCE, TARGET, 'contact', CONTACT)
        getDb.mockReturnValue({
            doc: () => ({
                get: () => Promise.resolve({ exists: true, data: () => ({ projectMove: { status: 'failed' } }) }),
            }),
        })
        await expect(waitForProjectMoveCompletion(SOURCE, TARGET, 'contact', CONTACT)).rejects.toThrow('move failed')
        expect(isLocalContactMovePending(SOURCE, CONTACT)).toBe(false)
    })
})
