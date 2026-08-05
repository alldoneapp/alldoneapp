/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import renderer from 'react-test-renderer'

import ConfirmPopup, { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from '../../components/UIComponents/ConfirmPopup'
import store from '../../redux/store'
import { hideConfirmPopup, showConfirmPopup } from '../../redux/actions'

const dummyProjectId = '-LcRVRo6mhbC0oXCcZ2F'
const dummyTaskId = '-LcRVT6MEWlqGQRkE2xw'

// The popup is a function component now, so hidePopup, executeTrigger and
// onKeyDown are internal. What a caller can observe is the store: showing the
// popup renders it, and dismissing it clears the visible flag.
const render = () =>
    renderer.create(
        <Provider store={store}>
            <ConfirmPopup />
        </Provider>
    )

const showDeleteTaskPopup = () =>
    store.dispatch(
        showConfirmPopup({
            trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
            object: { taskId: dummyTaskId, projectId: dummyProjectId },
        })
    )

describe('ConfirmPopup component', () => {
    afterEach(() => {
        store.dispatch(hideConfirmPopup())
    })

    it('renders nothing while there is nothing to confirm', () => {
        expect(render().toJSON()).toMatchSnapshot()
    })

    it('renders once a confirmation is requested', () => {
        showDeleteTaskPopup()

        expect(render().toJSON()).toMatchSnapshot()
    })

    it('keeps the requested trigger and subject on the store', () => {
        showDeleteTaskPopup()

        const { showConfirmPopupData } = store.getState()
        expect(showConfirmPopupData.visible).toBe(true)
        expect(showConfirmPopupData.trigger).toBe(CONFIRM_POPUP_TRIGGER_DELETE_TASK)
        expect(showConfirmPopupData.object.taskId).toBe(dummyTaskId)
    })

    it('clears the popup when it is dismissed', () => {
        showDeleteTaskPopup()

        store.dispatch(hideConfirmPopup())

        expect(store.getState().showConfirmPopupData.visible).toBe(false)
    })
})
