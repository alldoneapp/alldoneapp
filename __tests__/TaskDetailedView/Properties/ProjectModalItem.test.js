import React from 'react'
import ProjectModalItem from '../../../components/UIComponents/FloatModals/SelectProjectModal/ProjectModalItem'

import renderer from 'react-test-renderer'
import store from '../../../redux/store'
import { setProject } from '../../../redux/actions'
import Backend from '../../../utils/BackendBridge'

jest.mock('../../../utils/BackendBridge')
jest.mock('firebase', () => ({ firestore: {} }));
jest.mock('../../../components/TaskListView/Utils/TasksHelper',
    () => ({
        getTaskOwner: () => ({ uid: 0 })
    }));


describe('ProjectModalItem component', () => {
    const task = { id: 'id0', name: 'task1', recurrence: { type: 'never' }, userIds: [{}] }

    describe('ProjectModalItem snapshot test', () => {
        it('should render correctly', () => {
            const project = { name: 'Running out of cool names', color: 'the same with colors' }

            const tree = renderer.create(<ProjectModalItem project={project} newProject={project} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('ProjectModalItem methods', () => {
        it('should set the new project for the task', () => {
            const project = { id: 'id0', name: 'Running out of cool names', color: 'the same with colors', userIds: [] }
            const currentProject = { id: 'id1', name: 'Fotuto', color: 'Pirulí', userIds: [] }

            const tree = renderer.create(<ProjectModalItem project={project} task={task} newProject={project} closePopover={() => { }} />)
            const instance = tree.getInstance()

            store.dispatch(setProject(currentProject))
            instance.onPress()
            expect(Backend.setTaskProject.mock.calls.length).toEqual(1)
            expect(Backend.setTaskProject.mock.calls[0][0]['id']).toEqual(project.id)
            expect(Backend.setTaskProject.mock.calls[0][1]['id']).toEqual(project.id)
            expect(Backend.setTaskProject.mock.calls[0][2]['id']).toEqual(task.id)
            expect(store.getState().project).toEqual(project)
            expect(store.getState().showProjectPicker.visible).toEqual(false)
        })

        it('should hide the project picker', () => {
            const project = { id: 'id0', name: 'Running out of cool names', color: 'the same with colors' }
            const currentProject = { id: 'id1', name: 'Fotuto', color: 'Pirulí' }

            const tree = renderer.create(<ProjectModalItem project={project} task={task} newProject={project} />)
            const instance = tree.getInstance()

            store.dispatch(setProject(currentProject))
            instance.whenDone()
            expect(store.getState().showProjectPicker.visible).toEqual(false)
        })

        it('should attempt to animate', () => {
            const project = { id: 'id0', name: 'Running out of cool names', color: 'the same with colors' }
            const tree = renderer.create(<ProjectModalItem project={project} task={task} newProject={project} />)
            const instance = tree.getInstance()
            instance.tryAnimate()
            expect(store.getState().showProjectPicker.visible).toEqual(false)
        })
    })
})
