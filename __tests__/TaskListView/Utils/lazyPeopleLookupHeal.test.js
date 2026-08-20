/**
 * @jest-environment jsdom
 */

/**
 * AT-2386 — the synchronous name/photo funnels heal their own misses.
 *
 * Roughly thirty render sites resolve a person through `getUserInProject` / `getContactInProject`
 * (and `getWorkstreamById` / `getNormalAssistantInProject` for the other two collections). With the
 * per-project collections no longer loaded at login, a miss can mean "that project has not been
 * requested yet" rather than "no such person" — and the failure is silent, because the row simply
 * renders `getUnknownUserData()`. So the funnels report the miss and the loader arms the watcher.
 *
 * Reporting from the funnel rather than from each call site is the whole point: one forgotten call
 * site would never be noticed. These tests pin the funnel contract, and — just as importantly —
 * that a HIT stays silent, so the hot path does not report on every resolved row.
 */

import { seedProjects } from '../../../testUtils/seedStore'
import store from '../../../redux/store'
import { setContactsInProject, setUsersInProject, storeLoggedUser } from '../../../redux/actions'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import { getWorkstreamById } from '../../../components/Workstreams/WorkstreamHelper'
import {
    PROJECT_DATA_CONTACTS,
    PROJECT_DATA_USERS,
    PROJECT_DATA_WORKSTREAMS,
    requestProjectDataOnLookupMiss,
} from '../../../utils/InitialLoad/projectDataLoader'

jest.mock('../../../utils/InitialLoad/projectDataLoader', () => {
    const actual = jest.requireActual('../../../utils/InitialLoad/projectDataLoader')
    return { ...actual, requestProjectDataOnLookupMiss: jest.fn(() => true) }
})

const PROJECT_ID = 'seeded-project-0'

describe('AT-2386 people lookups request the data they are missing', () => {
    beforeEach(() => {
        requestProjectDataOnLookupMiss.mockClear()
        store.dispatch([
            ...seedProjects([{ id: PROJECT_ID }]),
            storeLoggedUser({ uid: 'u-me', projectIds: [PROJECT_ID] }),
        ])
    })

    describe('getContactInProject', () => {
        it('requests the project contacts when the contact cannot be resolved', () => {
            expect(TasksHelper.getContactInProject(PROJECT_ID, 'c-unknown')).toBeUndefined()

            expect(requestProjectDataOnLookupMiss).toHaveBeenCalledWith(PROJECT_ID, PROJECT_DATA_CONTACTS)
        })

        it('stays silent once the contact resolves', () => {
            store.dispatch(setContactsInProject(PROJECT_ID, [{ uid: 'c-1', displayName: 'Ada' }]))
            requestProjectDataOnLookupMiss.mockClear()

            expect(TasksHelper.getContactInProject(PROJECT_ID, 'c-1').displayName).toBe('Ada')

            expect(requestProjectDataOnLookupMiss).not.toHaveBeenCalled()
        })

        it('still returns undefined for a genuinely unknown contact in a loaded project', () => {
            // The heal is a request, not a promise that the person exists - the funnel keeps its
            // existing contract so the ~30 call sites are unchanged.
            store.dispatch(setContactsInProject(PROJECT_ID, [{ uid: 'c-1' }]))

            expect(TasksHelper.getContactInProject(PROJECT_ID, 'c-2')).toBeUndefined()
        })
    })

    describe('getUserInProject', () => {
        it('requests the project users when the user cannot be resolved', () => {
            expect(TasksHelper.getUserInProject(PROJECT_ID, 'u-unknown')).toBeUndefined()

            expect(requestProjectDataOnLookupMiss).toHaveBeenCalledWith(PROJECT_ID, PROJECT_DATA_USERS)
        })

        it('stays silent once the user resolves', () => {
            store.dispatch(setUsersInProject(PROJECT_ID, [{ uid: 'u-1', displayName: 'Grace' }]))
            requestProjectDataOnLookupMiss.mockClear()

            expect(TasksHelper.getUserInProject(PROJECT_ID, 'u-1').displayName).toBe('Grace')

            expect(requestProjectDataOnLookupMiss).not.toHaveBeenCalled()
        })
    })

    describe('getUsersInProject', () => {
        it('requests the users when the project has none yet, and still returns an array', () => {
            expect(TasksHelper.getUsersInProject(PROJECT_ID)).toEqual([])

            expect(requestProjectDataOnLookupMiss).toHaveBeenCalledWith(PROJECT_ID, PROJECT_DATA_USERS)
        })
    })

    describe('getWorkstreamById', () => {
        it('requests the project workstreams on a miss and keeps returning null', () => {
            expect(getWorkstreamById(PROJECT_ID, 'w-unknown')).toBeNull()

            expect(requestProjectDataOnLookupMiss).toHaveBeenCalledWith(PROJECT_ID, PROJECT_DATA_WORKSTREAMS)
        })
    })
})
