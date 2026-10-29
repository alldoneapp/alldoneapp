/**
 * AT-2906 — the crash behind "clicking an Anna activity row sometimes does not open it".
 *
 * Production stack (2026-10-29): onClickCapture → processUrl → processURLProjectsUserChats →
 * getUserInProject → requestProjectDataOnLookupMiss → watchProjectUsers → (first snapshot)
 * 'Set users in project' → `Array.find` → "Cannot read properties of undefined (reading 'uid')",
 * plus the same TypeError from every `useSelector(state => state.currentUser.uid)`.
 *
 * `getUserInProject` answers `undefined` — not null — for a project whose members have not been
 * loaded yet (AT-2386 loads them on demand), and the chats route tested `user !== null`, so it
 * stored `undefined` as the current user. These run against the REAL store and the REAL route.
 */
import store from '../../redux/store'
import { setSharedData, setUsersInProject, storeCurrentUser, storeLoggedUser } from '../../redux/actions'
import ChatHelper from '../../components/ChatsView/Utils/ChatHelper'
import { FOLLOWED_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import { requestProjectDataOnLookupMiss } from '../../utils/InitialLoad/projectDataLoader'

jest.mock('../../utils/InitialLoad/projectDataLoader', () => ({
    ...jest.requireActual('../../utils/InitialLoad/projectDataLoader'),
    requestProjectDataOnLookupMiss: jest.fn(),
}))

const loggedUser = { uid: 'u1', displayName: 'Karsten', projectIds: ['p1'], archivedProjectIds: [] }
const navigation = { navigate: jest.fn() }

beforeAll(() => {
    store.dispatch(storeLoggedUser(loggedUser))
    // A member project whose users were never loaded this session: seeded with [] as InitialLoad does.
    store.dispatch(setSharedData({ id: 'p1', name: 'Alldone Product', userIds: ['u1', 'u2'] }, [], [], [], []))
})

beforeEach(() => {
    store.dispatch(storeCurrentUser(store.getState().loggedUser))
    store.dispatch(setUsersInProject('p1', []))
    requestProjectDataOnLookupMiss.mockClear()
})

it('opening the chats of a project whose members are still loading keeps a real current user', () => {
    ChatHelper.processURLProjectsUserChats(navigation, 'p1', 'u1', FOLLOWED_TAB)

    // The miss still asks for the members — that is how they arrive.
    expect(requestProjectDataOnLookupMiss).toHaveBeenCalledWith('p1', expect.anything())
    expect(store.getState().currentUser?.uid).toBe('u1')
    // ...and their first snapshot is what used to throw inside the reducer.
    expect(() =>
        store.dispatch(setUsersInProject('p1', [{ uid: 'u1', displayName: 'K' }, { uid: 'u2' }]))
    ).not.toThrow()
    expect(store.getState().currentUser).toMatchObject({ uid: 'u1', displayName: 'K' })
})

it('uses the project member once the members are loaded', () => {
    store.dispatch(setUsersInProject('p1', [{ uid: 'u1', displayName: 'Member K' }]))
    ChatHelper.processURLProjectsUserChats(navigation, 'p1', 'u1', FOLLOWED_TAB)
    expect(store.getState().currentUser.displayName).toBe('Member K')
})

it('does not crash on a project this session cannot open', () => {
    expect(() => ChatHelper.processURLProjectsUserChats(navigation, 'unknown', 'u1', FOLLOWED_TAB)).not.toThrow()
    expect(store.getState().currentUser.uid).toBe('u1')
})

describe('the store never holds an undefined current user', () => {
    it('falls back to the logged user when a lookup miss is stored', () => {
        store.dispatch(storeCurrentUser(undefined))
        expect(store.getState().currentUser.uid).toBe('u1')
        store.dispatch(storeCurrentUser(null))
        expect(store.getState().currentUser.uid).toBe('u1')
    })

    it('a members snapshot with a malformed entry does not throw', () => {
        expect(() => store.dispatch(setUsersInProject('p1', [undefined, null, { uid: 'u1' }]))).not.toThrow()
        expect(store.getState().projectUsers.p1).toHaveLength(3)
        expect(store.getState().currentUser.uid).toBe('u1')
    })
})
