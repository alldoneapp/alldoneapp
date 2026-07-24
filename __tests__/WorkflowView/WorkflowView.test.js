import React from 'react'
import WorkflowView from '../../components/WorkflowView/WorkflowView'
import store from '../../redux/store'
import { storeLoggedUserProjects } from '../../redux/actions'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'
import Backend from '../../utils/BackendBridge'

jest.mock('../../utils/BackendBridge')
jest.mock('firebase', () => ({ firestore: {} }));

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            workflowStep: { reviewerName: 'name', reviewerPhotoURL: 'url' }
        })
    }),
    useStore: jest.fn().mockImplementation(() => ({
        getState: () => ({ loggedUser: { displayName: 'name' } })
    }))
}));

describe('WorkflowView component', () => {
    describe('WorkflowView snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<WorkflowView user={{ displayName: 'asd' }} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('WorkflowView methods', () => {
        xit('onNewStep should set the steps returned from the backend', () => {
            store.dispatch(storeLoggedUserProjects([{}]))

            const tree = renderer.create(
                <Provider store={store}>
                    <WorkflowView projectId="0" user={{ displayName: 'asd b' }} projectIndex={0} />
                </Provider>)
            const instance = tree.root.findByType(WorkflowView).instance
            instance.onNewStep({
                val: () => null,
            })
            expect(instance.state.steps).toEqual([])
        })

        xit('getFormattedName should get the correct way of the s', () => {
            const tree = renderer.create(<WorkflowView projectId="0" user={{ displayName: 'asd b' }} />)
            const instance = tree.getInstance()
            expect(instance.getFormattedName('s')).toEqual(`s' tasks`)
            expect(instance.getFormattedName('sa')).toEqual(`sa's tasks`)
        })

        it('componentWillUnmount should turn off steps listener on backend', () => {
            const tree = renderer.create(<WorkflowView projectId="0" user={{ uid: '1', displayName: 'asd b' }} />)
            tree.unmount()

            expect(Backend.offOnUserWorkflowChange.mock.calls.length).toEqual(1)
            expect(Backend.offOnUserWorkflowChange.mock.calls[0]).toEqual([])
        })

        it('componentDidMount should turn on steps listener on backend', () => {
            renderer.create(<WorkflowView projectId="0" user={{ uid: '1', displayName: 'asd b' }} />)
            const mockCalls = Backend.onUserWorkflowChange.mock.calls

            expect(mockCalls.length).toEqual(2)
            expect(mockCalls[1][0]).toEqual('1')
            expect(typeof mockCalls[0][1]).toEqual('function')
        })
    })
})
