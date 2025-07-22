/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import ParentTaskContainer from '../../components/TaskListView/ParentTaskContainer'
import { SubTaskList } from '../../__mocks__/MockData/SubTaskList'

jest.mock('react-native-web-webview')

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTask = {
    id: '-LyzhG-xGsc74qaNARtB',
    done: false,
    name: 'Hallo ',
    userIds: ['UUKU61Jc7ET8zE5ncN8F61HE19y1'],
    hasStar: false,
    created: 1579410000000,
    creatorId: 'UUKU61Jc7ET8zE5ncN8F61HE19y1',
    dueDate: 1579410000000,
    completed: null,
    isPrivate: true,
    parentId: null,
    recurrence: {type: 'never'},
    subtaskIds: ['-LyzhG-xGsc74qsf54dds', '-LyzhG-dfgr563tbeh4g5tf', '-LyzhG-6534tfryj8567j'],
}
describe('ParentTaskContainer component', () => {
    describe('ParentTaskContainer snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('ParentTaskContainer functions snapshot test', () => {
        it('check updateState function', () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateState()
            expect(tree.toJSON()).toMatchSnapshot()
        })

        xit('check toggleSubTaskList function', () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().toggleSubTaskList(true)
            let state = tree.getInstance().state
            expect(state.showSubTaskList).toBeTruthy()
        })

        xit('check toggleSubTaskIndicator function', () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().state.showSubTaskList = true

            tree.getInstance().toggleSubTaskIndicator(true)
            let state = tree.getInstance().state
            expect(state.showSubTaskIndicator).toBeTruthy()
        })

        it('check updateSubTaskList function', () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().updateSubTaskList(SubTaskList)
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('check onToggleModal function', () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />)
            expect(tree.toJSON()).toMatchSnapshot()

            tree.getInstance().onToggleModal(true)
            expect(tree.toJSON()).toMatchSnapshot()
        })

        it('check the unmount action', () => {
            const tree = renderer.create(<ParentTaskContainer task={dummyTask} projectId={dummyProjectId} />)
            tree.unmount()
        })
    })
})
