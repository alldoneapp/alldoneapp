/**
 * @jest-environment jsdom
 */

import { selectRandomSomedayTask } from './randomSomedayTask'
import { getDb } from '../firestore'
import store from '../../../redux/store'
import { BACKLOG_DATE_NUMERIC } from '../../../components/TaskListView/Utils/TasksHelper'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: jest.fn() },
}))

const USER_ID = 'user-1'

describe('selectRandomSomedayTask', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(Math, 'random').mockReturnValue(0)
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
        store.getState.mockReturnValue({
            loggedUser: { somedayTaskTriggerPercent: 100 },
            loggedUserProjects: [{ id: 'project-1', name: 'Project 1' }],
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('uses the server-owned reader projection before selecting an assigned Someday task', async () => {
        const query = {
            where: jest.fn(),
            get: jest.fn().mockResolvedValue({ docs: [] }),
        }
        query.where.mockReturnValue(query)
        const collection = jest.fn(() => query)
        getDb.mockReturnValue({ collection })

        await selectRandomSomedayTask(USER_ID)

        expect(collection).toHaveBeenCalledWith('items/project-1/tasks')
        expect(query.where.mock.calls).toEqual([
            ['readerIds', 'array-contains', USER_ID],
            ['dueDate', '==', BACKLOG_DATE_NUMERIC],
            ['done', '==', false],
            ['currentReviewerId', '==', USER_ID],
            ['parentId', '==', null],
        ])
        expect(query.get).toHaveBeenCalledTimes(1)
    })
})
