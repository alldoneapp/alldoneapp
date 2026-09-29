import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ActivityIndicator, Text } from 'react-native'
import { useSelector } from 'react-redux'

import ChatsEmailConnectionStatus from './ChatsEmailConnectionStatus'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))

const connectionId = 'email_google_aaaaaaaa'
let loggedUser

function renderStatus() {
    let tree
    act(() => {
        tree = renderer.create(<ChatsEmailConnectionStatus />)
    })
    return tree
}

const statusText = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .join(' ')

beforeEach(() => {
    jest.clearAllMocks()
    loggedUser = {
        emailConnections: { [connectionId]: { provider: 'google', emailAddress: 'a@gmail.com' } },
    }
    useSelector.mockImplementation(selector => selector({ loggedUser }))
})

test('shows a spinner until the email connection is verified, then clears it', async () => {
    let resolveCheck
    runHttpsCallableFunction.mockReturnValue(new Promise(resolve => (resolveCheck = resolve)))

    const tree = renderStatus()
    expect(runHttpsCallableFunction).toHaveBeenCalledWith('checkConnectionHealthSecondGen', {
        connectionIds: [connectionId],
    })
    expect(statusText(tree)).toContain('Checking email connections')
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1)

    await act(async () => {
        resolveCheck({ results: [{ connectionId, status: 'connected' }] })
    })

    expect(tree.toJSON()).toBeNull()
})

test('shows an uncertain result when the check fails, without claiming the account is disconnected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    runHttpsCallableFunction.mockRejectedValue(new Error('offline'))

    const tree = renderStatus()
    await act(async () => {})

    expect(statusText(tree)).toContain('Could not verify email connections')
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    warn.mockRestore()
})

test('shows a reconnect instruction when the provider confirms an expired grant', async () => {
    runHttpsCallableFunction.mockResolvedValue({ results: [{ connectionId, status: 'reconnect_required' }] })

    const tree = renderStatus()
    await act(async () => {})

    expect(statusText(tree)).toContain('Reconnect email in Settings > Integrations')
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
})

test('does not run or show a check without an email account', () => {
    loggedUser = { emailConnections: {}, apisConnected: {} }

    const tree = renderStatus()

    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    expect(tree.toJSON()).toBeNull()
})
