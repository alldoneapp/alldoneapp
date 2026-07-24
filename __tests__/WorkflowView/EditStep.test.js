/**
 * @jest-environment jsdom
 */

import React from 'react'
import EditStep from '../../components/WorkflowView/EditStep'
import renderer from 'react-test-renderer'
jest.mock('../../utils/BackendBridge')

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            workflowStep: { reviewerName: 'name', reviewerPhotoURL: 'url' }
        })
    }),
    useDispatch: jest.fn().mockImplementation(() => () => { }),
    useStore: jest.fn().mockImplementation(() => ({
        getState: () => ({ loggedUser: {} })
    }))
}));

describe('EditStep component', () => {
    const onCancelAction = jest.fn()
    const sampleStep = { id: '1', description: 'a', reviewerName: 'Matt Davis' }

    describe('EditStep snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(
                <EditStep
                    formType={'new'}
                    step={sampleStep}
                    defaultReviewer={{ photoURL: 'aasd', reviewerName: 'a' }}
                    onCancelAction={onCancelAction}
                />
            )
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('EditStep methods', () => {
        xit('onInputKeyPress should the workflow and dismiss clean the modal', () => {
            const tree = renderer.create(
                <EditStep
                    formType={'new'}
                    step={sampleStep}
                    defaultReviewer={{ reviewerName: 'a' }}
                    onCancelAction={onCancelAction}
                />
            )
            const instance = tree.getInstance()
            instance.onInputKeyPress({ nativeEvent: { key: 'Enter' } })
            expect(onCancelAction.mock.calls.length).toEqual(1)
        })

        xit('onChangeInputText should update text in the store', () => {
            const tree = renderer.create(
                <EditStep
                    formType={'new'}
                    step={sampleStep}
                    defaultReviewer={{ reviewerName: 'a' }}
                    onCancelAction={onCancelAction}
                />
            )
            const instance = tree.getInstance()
            instance.onChangeInputText('qwe')
            expect(instance.state.description).toEqual('qwe')
        })
    })
})
