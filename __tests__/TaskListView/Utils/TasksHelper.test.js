/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TasksDone_1, TasksOpen_1, TasksPending_1 } from '../../../__mocks__/MockData/TasksView/TasksListInput_1'
import TasksHelper, {
    RECURRENCE_TEXT_VALUES,
    TASK_TYPE_DONE,
    TASK_TYPE_OPEN,
    TASK_TYPE_PENDING,
} from '../../../components/TaskListView/Utils/TasksHelper'
import store from '../../../redux/store'
import { storeCurrentUser, storeLoggedUser, storeLoggedUserProjects } from '../../../redux/actions'
import { ALL_PROJECTS_INDEX } from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'

jest.mock('firebase', () => ({ firestore: {} }))

const dummyUser = { uid: 'C08CK8x1I5YS2lxVixuLHaF3SrA3' }

const navigation = { navigate: route => route }

describe('TasksHelper class', () => {
    beforeEach(() => {
        store.dispatch([
            storeLoggedUserProjects([{ id: 'id1' }]),
            storeLoggedUser(dummyUser),
            storeCurrentUser(dummyUser),
        ])
    })
    describe('Function getTodayProgressByProject', () => {
        it('Should execute correctly', async () => {
            let inputAmounts = { open: 2, pending: 2, done: 6 }
            let progress = TasksHelper.getTodayProgressByProject(inputAmounts)
            expect(progress).toEqual(60)
        })
    })

    describe('Function getTaskType', () => {
        it('Identify Open task correctly', async () => {
            store.dispatch([storeLoggedUser({ uid: '-Uxyz_1' }), storeCurrentUser({ uid: '-Uxyz_1' })])
            let value = TasksHelper.getTaskType(TasksOpen_1)
            expect(value).toEqual(TASK_TYPE_OPEN)
        })
        it('Identify Pending task correctly', async () => {
            store.dispatch([storeLoggedUser({ uid: '-Uxyz_1' }), storeCurrentUser({ uid: '-Uxyz_1' })])
            let value = TasksHelper.getTaskType(TasksPending_1)
            expect(value).toEqual(TASK_TYPE_PENDING)
        })
        it('Identify Done task correctly', async () => {
            store.dispatch([storeLoggedUser({ uid: '-Uxyz_1' }), storeCurrentUser({ uid: '-Uxyz_1' })])
            let value = TasksHelper.getTaskType(TasksDone_1)
            expect(value).toEqual(TASK_TYPE_DONE)
        })
    })

    describe('Function isOpenTask', () => {
        it('Identify Open task correctly', async () => {
            const user = { uid: '-Uxyz_1' }
            let value = TasksHelper.isOpenTask(TasksOpen_1, user, user)
            expect(value).toBeTruthy()
        })
    })

    describe('Function isPendingTask', () => {
        it('Identify Pending task correctly', async () => {
            const user = { uid: '-Uxyz_1' }
            let value = TasksHelper.isPendingTask(TasksPending_1, user)
            expect(value).toBeTruthy()
        })
    })

    describe('Function isDoneTask', () => {
        it('Identify Done task correctly', async () => {
            const user = { uid: '-Uxyz_1' }
            let value = TasksHelper.isDoneTask(TasksDone_1, user, user)
            expect(value).toBeTruthy()
        })
    })

    describe('Function taskMatchWithSearchText', () => {
        it('The task match the search', async () => {
            let value = TasksHelper.taskMatchWithSearchText(TasksOpen_1, 'new open')
            expect(value).toBeTruthy()
        })
        it('The task not match the search', async () => {
            let value = TasksHelper.taskMatchWithSearchText(TasksOpen_1, 'new pending')
            expect(value).toBeFalsy()
        })
    })

    describe('Function getNewDefaultTask', () => {
        const defaultTask = {
            completed: null,
            created: Date.now(),
            creatorId: '-Uxyz_1',
            done: false,
            dueDate: Date.now(),
            estimations: { '-1': 0 },
            followerUserIds: [],
            followerUsers: [],
            hasStar: false,
            isPrivate: false,
            lastChangeUserId: '-Uxyz_1',
            mentionedUserIds: [],
            name: '',
            userId: '-Uxyz_1',
            userIds: ['-Uxyz_1'],
            stepHistory: [-1],
            parentId: null,
            subtaskIds: [],
            recurrence: null,
        }
        it('The function work correctly', async () => {
            store.dispatch([storeLoggedUser({ uid: '-Uxyz_1' }), storeCurrentUser({ uid: '-Uxyz_1' })])
            const value = TasksHelper.getNewDefaultTask()
            expect(value).toEqual(defaultTask)
        })
    })

    describe('Function processURLAllProjectsTasks', () => {
        it('Function work correctly', () => {
            store.dispatch(storeLoggedUser({ uid: '-Uxyz_1' }))
            TasksHelper.processURLAllProjectsTasks(navigation)

            const storeState = store.getState()
            expect(storeState.selectedProjectIndex).toEqual(ALL_PROJECTS_INDEX)
            expect(storeState.hiddenSideMenuUser).toBeFalsy()
            expect(storeState.currentUser).toEqual({ uid: '-Uxyz_1' })
            expect(storeState.selectedNavItem).toEqual(DV_TAB_ROOT_TASKS)
        })
    })

    describe('Function getRecurrenceText', () => {
        it('Function work correctly for never value', () => {
            const test = 'never'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for daily value', () => {
            const test = 'daily'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for everyWorkday value', () => {
            const test = 'everyWorkday'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for weekly value', () => {
            const test = 'weekly'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for every2Weeks value', () => {
            const test = 'every2Weeks'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for every3Weeks value', () => {
            const test = 'every3Weeks'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for monthly value', () => {
            const test = 'monthly'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for every3Months value', () => {
            const test = 'every3Months'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for every6Months value', () => {
            const test = 'every6Months'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
        it('Function work correctly for annually value', () => {
            const test = 'annually'
            const value = TasksHelper.getRecurrenceText(test)
            expect(value).toEqual(RECURRENCE_TEXT_VALUES[test])
        })
    })
})
