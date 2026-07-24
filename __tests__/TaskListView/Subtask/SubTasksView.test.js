/**
 * @jest-environment jsdom
 */

import React from 'react'
import SubTasksView from '../../../components/TaskListView/Subtask/SubTasksView'
import renderer from 'react-test-renderer'

import { SubTaskList } from '../../../__mocks__/MockData/SubTaskList'

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
    subtaskIds: ['-LyzhG-xGsc74qsf54dds', '-LyzhG-dfgr563tbeh4g5tf', '-LyzhG-6534tfryj8567j'],
}
describe('SubTasksView component', () => {
    describe('SubTasksView snapshot test', () => {
        it('should render correctly', async () => {
            const tree = renderer
                .create(<SubTasksView parentTask={dummyTask} projectId={dummyProjectId} subTasksList={SubTaskList} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
