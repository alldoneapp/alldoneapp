import React from 'react'
import EstimationModal from '../../components/UIComponents/FloatModals/EstimationModal/EstimationModal'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useStore: jest.fn().mockImplementation(() => ({
        getState: () => {}
    }))
}));

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'
const task = { id: dummyTaskId, name: 'My task' }

describe('StoryPointModal component', () => {
    describe('StoryPointModal snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer
                .create(<EstimationModal projectId={dummyProjectId} task={task} closePopover={() => {}} />)
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function selectPoint snapshot test', () => {
        xit('Should execute and render correctly', () => {
            const tree = renderer.create(
                <EstimationModal projectId={dummyProjectId} task={task} closePopover={() => {}} />
            )

            tree.getInstance().selectPoint(2)
            expect(tree.toJSON()).toMatchSnapshot()

            const state = tree.getInstance().state
            expect(state.selectedPoint).toEqual(2)
        })
    })
})
