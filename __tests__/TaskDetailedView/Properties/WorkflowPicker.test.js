/**
 * @jest-environment jsdom
 */

import React from 'react'
import WorkflowPicker from '../../../components/TaskDetailedView/Properties/WorkflowPicker'
import store from '../../../redux/store'
import { storeCurrentUser } from '../../../redux/actions'

import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            currentUser: {},
            assignee: { workflow: {} },
        })
    }),
    useDispatch: jest.fn(),
    useStore: jest.fn().mockImplementation(() => {
        return {
            getState: () => {
                return { selectedProjectIndex: 0, projectsUsers: [[]] }
            },
        }
    }),
}))

describe('WorkflowPicker component', () => {
    let tree

    afterEach(async () => {
        // The real picker mounts a popover, viewport listeners and a subscribed Button.
        // Flush and unmount while jsdom still exists; leaving the renderer mounted can
        // let React's scheduled work outlive the suite and crash the entire CI worker.
        await act(async () => {
            tree?.unmount()
        })
        tree = null
    })

    describe('WorkflowPicker snapshot test', () => {
        it('should render correctly', async () => {
            await act(async () => {
                store.dispatch(storeCurrentUser({ workflow: [] }))
                tree = renderer.create(<WorkflowPicker task={{ id: '0', done: false, inReview: false, toReview: 0 }} />)
            })
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
