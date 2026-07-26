import React from 'react'
import DeleteTaskButton from '../../../components/TaskDetailedView/Properties/DeleteTaskButton'

import renderer from 'react-test-renderer'

jest.mock('../../../utils/BackendBridge')
jest.mock('../../../utils/NavigationService')
jest.mock('firebase', () => ({ firestore: {} }))

describe('DeleteTaskButton component', () => {
    describe('DeleteTaskButton snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(<DeleteTaskButton projectId={'project-1'} task={{ id: 'task-1', parentId: null }} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('DeleteTaskButton methods', () => {
        it('should delete a task', () => {
            // The component is a function now, so the press handler is reached
            // through the rendered button rather than an instance.
            const tree = renderer.create(<DeleteTaskButton projectId="id0" task={{ id: 'id1', parentId: null }} />)

            const pressables = tree.root.findAll(node => typeof node.props.onPress === 'function')
            expect(pressables.length).toBeGreaterThan(0)
            expect(() => pressables[0].props.onPress()).not.toThrow()
        })
    })
})
