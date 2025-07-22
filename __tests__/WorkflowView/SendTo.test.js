/**
 * @jest-environment jsdom
 */

import React from 'react'
import SendTo from '../../components/WorkflowView/SendTo'

import renderer from 'react-test-renderer'
import store from '../../redux/store'
jest.mock('react-tiny-popover')

jest.mock("react-redux", () => ({
    ...jest.requireActual("react-redux"),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            workflowStep: { reviewerName: 'name', reviewerPhotoURL: 'url' }
        })
    }),
    useDispatch: jest.fn().mockImplementation(() => () => { }),
    useStore: jest.fn()
}));

describe('SendTo component', () => {
    const currentUser = { uid: '0', photoURL: 'a', displayName: 'b' }
    const projectIndex = '1'
    const onChangeValue = jest.fn()

    describe('SendTo snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer
                .create(
                    <SendTo
                        defaultReviewer={{ reviewerPhotoURL: 'a', reviewerName: 'a' }}
                        currentUser={currentUser}
                        projectIndex={projectIndex}
                        onChangeValue={onChangeValue}
                    />
                )
                .toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('SendTo methods', () => {
        xit('hidePopover should hide the popover', () => {
            const tree = renderer.create(
                <SendTo
                    defaultReviewer={{ reviewerPhotoURL: 'a', reviewerName: 'a' }}
                    currentUser={currentUser}
                    projectIndex={projectIndex}
                    onChangeValue={onChangeValue}
                />
            )
            const instance = tree.getInstance()
            instance.hidePopover('a')
            expect(instance.state.visiblePopover).toEqual(false)
            expect(store.getState().showFloatPopup).toEqual(0)
        })

        xit('showPopover should show the popover', () => {
            const tree = renderer.create(
                <SendTo
                    defaultReviewer={{ reviewerPhotoURL: 'a', reviewerName: 'a' }}
                    currentUser={currentUser}
                    projectIndex={projectIndex}
                    onChangeValue={onChangeValue}
                />
            )
            const instance = tree.getInstance()
            instance.showPopover()
            expect(instance.state.visiblePopover).toEqual(true)
            expect(store.getState().showFloatPopup).toEqual(1)
        })

        xit('getText correctly return the text to show', () => {
            const tree = renderer.create(
                <SendTo
                    defaultReviewer={{ reviewerPhotoURL: 'a', reviewerName: 'a' }}
                    currentUser={currentUser}
                    projectIndex={projectIndex}
                    onChangeValue={onChangeValue}
                />
            )
            const instance = tree.getInstance()
            expect(instance.getText()).toEqual('Send to a')
            instance.state.sendTo = { displayName: 'a b' }
            expect(instance.getText()).toEqual('Send to a')
        })
    })
})
