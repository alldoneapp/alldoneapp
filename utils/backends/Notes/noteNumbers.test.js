import { getCountFromServer } from 'firebase/firestore'

import store from '../../../redux/store'
import { getDb } from '../firestore'
import { getAllNotesAmount, getFollowedNotesAmount } from './noteNumbers'

jest.mock('firebase/firestore', () => ({ getCountFromServer: jest.fn() }))
jest.mock('../firestore', () => ({ getDb: jest.fn(), globalWatcherUnsub: {} }))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))

const countSnapshot = count => ({ data: () => ({ count }) })

describe('aggregated note counts', () => {
    let collection
    let where

    beforeEach(() => {
        jest.clearAllMocks()
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
        store.getState.mockReturnValue({ loggedUser: { uid: 'user-1', isAnonymous: false } })

        where = jest.fn(() => ({ _delegate: {} }))
        collection = jest.fn(() => ({ where }))
        getDb.mockReturnValue({ collection })
        getCountFromServer.mockResolvedValue(countSnapshot(3))
    })

    it('counts visible notes without downloading their documents', async () => {
        await expect(getAllNotesAmount(['project-1', 'project-2'])).resolves.toBe(6)

        expect(collection.mock.calls.map(([path]) => path)).toEqual([
            'noteItems/project-1/notes',
            'noteItems/project-2/notes',
        ])
        expect(where).toHaveBeenCalledWith('readerIds', 'array-contains', 'user-1')
        expect(getCountFromServer).toHaveBeenCalledTimes(2)
    })

    it('uses the public projection sentinel for anonymous shared-project viewers', async () => {
        store.getState.mockReturnValue({ loggedUser: { uid: 'anonymous-user', isAnonymous: true } })

        await expect(getAllNotesAmount(['project-1'])).resolves.toBe(3)

        expect(where).toHaveBeenCalledWith('readerIds', 'array-contains', 0)
    })

    it('uses the followed visibility query for the followed tab', async () => {
        await expect(getFollowedNotesAmount(['project-1'])).resolves.toBe(3)

        expect(where).toHaveBeenCalledWith('followedReaderIds', 'array-contains', 'user-1')
    })

    it('limits count fan-out so header work cannot monopolize startup', async () => {
        const releases = []
        getCountFromServer.mockImplementation(
            () => new Promise(resolve => releases.push(() => resolve(countSnapshot(1))))
        )

        const result = getAllNotesAmount(['project-1', 'project-2', 'project-3', 'project-4', 'project-5'])
        expect(getCountFromServer).toHaveBeenCalledTimes(4)

        releases.splice(0, 4).forEach(release => release())
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(getCountFromServer).toHaveBeenCalledTimes(5)

        releases[0]()
        await expect(result).resolves.toBe(5)
    })

    it('fails fast instead of waiting for a server-only aggregation while offline', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })

        await expect(getAllNotesAmount(['project-1'])).rejects.toMatchObject({ code: 'offline' })
        expect(getCountFromServer).not.toHaveBeenCalled()
    })
})
