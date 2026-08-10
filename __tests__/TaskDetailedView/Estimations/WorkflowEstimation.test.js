/**
 * @jest-environment jsdom
 */

import React from 'react'
import store from '../../../redux/store'
import { seedProjects } from '../../../testUtils/seedStore'
import { ESTIMATION_TYPE_TIME } from '../../../utils/EstimationHelper'
import WorkflowEstimation from '../../../components/TaskDetailedView/Estimations/WorkflowEstimation'
import Backend from '../../../utils/BackendBridge'

import renderer from 'react-test-renderer'

// The workflow listener effect really runs under RNW and reaches the
// uninitialized firestore `db`. Object.create keeps the real module on the
// prototype without eagerly resolving its circular re-exports.
jest.mock('../../../utils/backends/firestore', () =>
    Object.assign(Object.create(jest.requireActual('../../../utils/backends/firestore')), {
        onUserWorkflowChange: jest.fn(),
        offOnUserWorkflowChange: jest.fn(),
    })
)

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            // Users are keyed by project id now rather than a selected-project list.
            projectUsers: { 1: [{ uid: 0 }] },
            projectWorkstreams: { 1: [] },
            projectAssistants: { 1: [] },
            loggedUserProjects: [{ id: '1' }],
            loggedUserProjectsMap: { 1: { id: '1', index: 0 } },
            loggedUser: {
                uid: 0,
                projectIds: ['1'],
                archivedProjectIds: [],
                guideProjectIds: [],
                templateProjectIds: [],
            },
        })
    }),
}))

// The estimation helpers resolve the project through the real store rather
// than the mocked selector, so it has to be seeded under the same id.
beforeAll(() => {
    store.dispatch(seedProjects([{ id: '1', name: 'My project', estimationType: ESTIMATION_TYPE_TIME }]))
})

describe('WorkflowEstimation component', () => {
    it('should render correctly', () => {
        const tree = renderer
            .create(
                <WorkflowEstimation
                    task={{ done: true, estimations: [], userId: 'user-1', userIds: ['user-1'] }}
                    projectId={'1'}
                />
            )
            .toJSON()
        expect(tree).toMatchSnapshot()
    })

    it('should call Backend.offOnUserWorkflowChange when it is unmounted', () => {
        // Given
        Backend.offOnUserWorkflowChange = jest.fn()
        const tree = renderer.create(
            <WorkflowEstimation
                task={{ done: true, estimations: [], userId: 'user-1', userIds: ['user-1'] }}
                projectId={'1'}
            />
        )
        // When
        tree.unmount()
        // Then
        expect(Backend.offOnUserWorkflowChange).toHaveBeenCalledTimes(1)
    })
})
