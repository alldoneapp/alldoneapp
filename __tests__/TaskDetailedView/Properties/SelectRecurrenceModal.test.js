import React from 'react'
import SelectRecurrenceModal from '../../../components/TaskDetailedView/Properties/SelectRecurrenceModal'
import store from '../../../redux/store'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

describe('SelectProjectModal component', () => {
    const task = { id: 'id1', name: 'task1', recurrence: { type: 'never' } }
    const project = { id: 'id0', name: 'project1' }

    describe('SelectRecurrenceModal snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SelectRecurrenceModal projectId={project.id} task={task} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('SelectRecurrenceModal methods', () => {
        it('should close the modal', () => {
            const tree = renderer.create(<SelectRecurrenceModal projectId={project.id} task={task} />)
            const instance = tree.getInstance()
            instance.onPressClose()
            expect(store.getState().showRecurrenceModal.visible).toEqual(false)
        })

        it('should update the state on store updates', () => {
            const tree = renderer.create(<SelectRecurrenceModal projectId={project.id} task={task} />)
            const instance = tree.getInstance()
            instance.updateState()
            expect(instance.state.showRecurrenceModal.visible).toEqual(false)
        })

        it('should update the layout in the store when measured', () => {
            const tree = renderer.create(<SelectRecurrenceModal projectId={project.id} task={task} />)
            const instance = tree.getInstance()
            const layout = { x: 1, y: 2, width: 3, height: 4 }
            instance.onMeasured(layout.x, layout.y, layout.width, layout.height)
            expect(store.getState().showRecurrenceModal.layout).toEqual(layout)
        })
    })
})
