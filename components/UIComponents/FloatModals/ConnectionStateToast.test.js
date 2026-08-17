import React from 'react'
import { Provider } from 'react-redux'
import { create, act } from 'react-test-renderer'

import ConnectionStateToast from './ConnectionStateToast'
import store from '../../../redux/store'
import { setConnectionState } from '../../../redux/actions'

const renderToast = () => {
    let tree
    act(() => {
        tree = create(
            <Provider store={store}>
                <ConnectionStateToast />
            </Provider>
        )
    })
    return tree
}

const treeText = tree => JSON.stringify(tree.toJSON())

describe('ConnectionStateToast (global mount)', () => {
    afterEach(() => {
        act(() => {
            store.dispatch(setConnectionState(''))
        })
    })

    it('renders nothing before any connectivity transition', () => {
        const tree = renderToast()
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })

    it('shows the offline toast when the app goes offline', () => {
        const tree = renderToast()
        act(() => {
            store.dispatch(setConnectionState('offline'))
        })
        expect(treeText(tree)).toContain('Alldone is offline')
        act(() => tree.unmount())
    })

    it('shows the recovery toast when the app comes back online', () => {
        const tree = renderToast()
        act(() => {
            store.dispatch(setConnectionState('offline'))
        })
        act(() => {
            store.dispatch(setConnectionState('online'))
        })
        expect(treeText(tree)).toContain('Alldone is online')
        act(() => tree.unmount())
    })

    it('re-shows the toast on the next transition after an earlier state', () => {
        const tree = renderToast()
        act(() => {
            store.dispatch(setConnectionState('offline'))
        })
        act(() => {
            store.dispatch(setConnectionState('online'))
        })
        act(() => {
            store.dispatch(setConnectionState('offline'))
        })
        expect(treeText(tree)).toContain('Alldone is offline')
        act(() => tree.unmount())
    })
})
