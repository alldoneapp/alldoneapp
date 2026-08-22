import React from 'react'
import { Provider } from 'react-redux'
import { create, act } from 'react-test-renderer'

// AppPopover is exercised by its own suites; here it would only demand real DOM
// rects (react-tiny-popover measures its target), and mocking those unrealistically
// is exactly the trap AT-2189 documents. Render it as a passthrough so this suite
// tests the chip's own decisions: what shows, when, and what the button calls.
jest.mock('../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) =>
        React.createElement(React.Fragment, null, children, isOpen ? content : null)
})

import ConnectionStatusChip from './ConnectionStatusChip'
import store from '../../redux/store'
import { setConnectionHealth } from '../../redux/actions'
import * as connectionHealth from '../../utils/connectionHealth'

const renderChip = () => {
    let tree
    act(() => {
        tree = create(
            <Provider store={store}>
                <ConnectionStatusChip />
            </Provider>
        )
    })
    return tree
}

const treeText = tree => JSON.stringify(tree.toJSON())

const setHealth = health =>
    act(() => {
        store.dispatch(setConnectionHealth(health))
    })

describe('ConnectionStatusChip', () => {
    afterEach(() => {
        setHealth('live')
        jest.restoreAllMocks()
    })

    it('renders nothing while the connection is live', () => {
        const tree = renderChip()
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })

    it('renders nothing for an unknown state rather than an empty chip', () => {
        const tree = renderChip()
        setHealth('something-new')
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })

    it('shows the stale chip — the state the app could not see before', () => {
        const tree = renderChip()
        setHealth('stale')
        expect(tree.toJSON()).not.toBeNull()
        expect(treeText(tree)).toContain('Not up to date')
        act(() => tree.unmount())
    })

    it('shows the reconnecting chip', () => {
        const tree = renderChip()
        setHealth('reconnecting')
        expect(treeText(tree)).toContain('Reconnecting')
        act(() => tree.unmount())
    })

    it('offers offline work as soon as the first probe enters reconnecting', async () => {
        const workOffline = jest.spyOn(connectionHealth, 'continueOffline').mockResolvedValue('offline')
        const tree = renderChip()
        setHealth('reconnecting')

        const chip = tree.root.findByProps({ testID: 'connection-status-chip-reconnecting' })
        act(() => {
            chip.props.onPress()
        })

        const button = tree.root.findByProps({ testID: 'connection-status-work-offline' })
        await act(async () => {
            await button.props.onPress()
        })

        expect(workOffline).toHaveBeenCalledTimes(1)
        act(() => tree.unmount())
    })

    it('shows the offline chip', () => {
        const tree = renderChip()
        setHealth('offline')
        expect(treeText(tree)).toContain('Offline')
        act(() => tree.unmount())
    })

    it('goes back to rendering nothing when the connection recovers', () => {
        const tree = renderChip()
        setHealth('stale')
        expect(tree.toJSON()).not.toBeNull()
        setHealth('live')
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })

    it('opens the explanation, and reconnecting goes through connectionHealth', async () => {
        const reconnect = jest.spyOn(connectionHealth, 'reconnectNow').mockResolvedValue('live')

        const tree = renderChip()
        setHealth('stale')

        const chip = tree.root.findByProps({ testID: 'connection-status-chip-stale' })
        act(() => {
            chip.props.onPress()
        })

        // The card explains the state and must never claim work is blocked —
        // Firestore queues writes and flushes them on reconnect.
        expect(treeText(tree)).toContain('You can keep working')

        const button = tree.root.findByProps({ testID: 'connection-status-reconnect' })
        await act(async () => {
            await button.props.onPress()
        })

        expect(reconnect).toHaveBeenCalled()
        act(() => tree.unmount())
    })
})
