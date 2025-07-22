/**
 * @jest-environment jsdom
 */

import React from 'react'
import ConfirmPopup, { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from '../../components/UIComponents/ConfirmPopup'

import renderer from 'react-test-renderer'
import store from '../../redux/store'
import { setConfirmPopupAction } from '../../redux/actions'

jest.mock('firebase', () => ({ firestore: {} }))

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'

describe('ConfirmPopup component', () => {
    describe('ConfirmPopup snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<ConfirmPopup />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('Function hidePopup snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(<ConfirmPopup />)

            tree.getInstance().hidePopup()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function executeTrigger snapshot test', () => {
        it('Should execute and render correctly', () => {
            store.dispatch(
                setConfirmPopupAction({
                    trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                    object: { taskId: dummyTaskId, projectId: dummyProjectId },
                })
            )
            const tree = renderer.create(<ConfirmPopup />)

            tree.getInstance().executeTrigger()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })

    describe('Function onKeyDown snapshot test', () => {
        it('Should execute and render correctly', () => {
            const tree = renderer.create(<ConfirmPopup />)
            const instance = tree.getInstance()
            instance.onKeyDown({ key: 'Escape', preventDefault: () => { } })
            expect(store.getState().showConfirmPopup.visible).toBeFalsy()
            expect(tree.toJSON()).toMatchSnapshot()
        })
    })
})
