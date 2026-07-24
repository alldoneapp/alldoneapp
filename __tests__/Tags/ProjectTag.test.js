/**
 * @jest-environment jsdom
 */

import React from 'react'
import ProjectTag from '../../components/Tags/ProjectTag'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
jest.mock('../../components/TaskListView/Utils/TasksHelper')

import renderer from 'react-test-renderer'

const dummyProject = { id: '-Asd', color: '#fff000', name: 'Project X' }

describe('Project tag component', () => {
    describe('Project tag snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<ProjectTag project={dummyProject} style={{ marginHorizontal: 16 }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function onPress', () => {
        it('should execute correctly', () => {
            const tree = renderer.create(<ProjectTag project={dummyProject} style={{ marginHorizontal: 16 }} />)
            const instance = tree.getInstance()
            instance.onPress()

            expect(TasksHelper.processURLProjectsUserTasks.mock.calls.length).toEqual(1)
            expect(TasksHelper.processURLProjectsUserTasks.mock.calls[0][1]).toEqual('-Asd')
        })
    })
})
