import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { getEmailCheckCadence, getEmailCheckConfigKeys, useEmailCheckCadence } from './useEmailCheckCadence'
import { watchGmailLabelingConfigs } from '../../utils/backends/Gmail/gmailLabelingFirestore'

jest.mock('../../utils/backends/Gmail/gmailLabelingFirestore', () => ({ watchGmailLabelingConfigs: jest.fn() }))

const connection = {
    connectionId: 'email_google_aaaaaaaa',
    provider: 'google',
    email: 'a@gmail.com',
    defaultProjectId: 'project1',
}
const user = {
    uid: 'user1',
    premium: { status: 'premium' },
    apisConnected: {
        project1: { gmail: true, gmailEmail: 'A@gmail.com' },
        project2: { gmail: true, gmailEmail: 'a@gmail.com' },
        other: { gmail: true, gmailEmail: 'b@gmail.com' },
    },
}

test('resolves legacy project configs for the mailbox and prefers the migrated account config', () => {
    expect(getEmailCheckConfigKeys(user, connection)).toEqual([connection.connectionId, 'project1', 'project2'])
    const configs = { gmailLabeling_project2: { enabled: true, syncIntervalMinutes: 120 } }
    expect(getEmailCheckCadence(user, connection, configs)).toEqual({ status: 'enabled', minutes: 120 })
    configs.gmailLabeling_project1 = { enabled: true, syncIntervalMinutes: 90 }
    expect(getEmailCheckCadence(user, connection, configs)).toEqual({ status: 'enabled', minutes: 90 })
    configs[`gmailLabeling_${connection.connectionId}`] = { enabled: false }
    expect(getEmailCheckCadence(user, connection, configs)).toEqual({ status: 'disabled' })
})

test('distinguishes unavailable, loading, unconfigured, disabled and unsupported checks', () => {
    expect(getEmailCheckCadence(user, connection, null)).toEqual({ status: 'loading' })
    expect(getEmailCheckCadence(user, connection, null, true)).toEqual({ status: 'unknown' })
    expect(getEmailCheckCadence(user, connection, {})).toEqual({ status: 'unconfigured' })
    expect(getEmailCheckCadence(user, connection, { gmailLabeling_project1: { enabled: false } })).toEqual({
        status: 'disabled',
    })
    expect(getEmailCheckCadence(user, { ...connection, provider: 'microsoft' }, {})).toEqual({ status: 'unsupported' })
    expect(getEmailCheckCadence({ ...user, premium: { status: 'free' } }, connection, {})).toEqual({
        status: 'premium_required',
    })
    expect(
        getEmailCheckCadence(user, connection, { gmailLabeling_project1: { enabled: true, migratedTo: 'other' } })
    ).toEqual({
        status: 'disabled',
    })
})

test.each([
    [5, 30],
    [60, 60],
    [90.5, 90],
    ['120', 120],
    [undefined, 30],
    ['invalid', 30],
    [null, 30],
])('uses the scheduler interval normalization for stored value %s', (value, minutes) => {
    expect(
        getEmailCheckCadence(user, connection, {
            gmailLabeling_project1: { enabled: true, syncIntervalMinutes: value },
        })
    ).toEqual({ status: 'enabled', minutes })
})

let latest
function Probe({ loggedUser = user, connections = [connection] }) {
    latest = useEmailCheckCadence(loggedUser, connections)
    return null
}

beforeEach(() => jest.clearAllMocks())

test('watches once per user, handles read failures and unsubscribes without accepting late snapshots', () => {
    let onChange, onError
    const unsubscribe = jest.fn()
    watchGmailLabelingConfigs.mockImplementation((userId, next, error) => {
        onChange = next
        onError = error
        return unsubscribe
    })
    let tree
    act(() => {
        tree = renderer.create(<Probe />)
    })
    expect(latest).toEqual([{ status: 'loading' }])
    act(() => onChange({ gmailLabeling_project1: { enabled: true, syncIntervalMinutes: 60 } }))
    expect(latest).toEqual([{ status: 'enabled', minutes: 60 }])
    act(() => tree.update(<Probe loggedUser={{ ...user }} connections={[{ ...connection }]} />))
    expect(watchGmailLabelingConfigs).toHaveBeenCalledTimes(1)
    act(() => onError(new Error('offline')))
    expect(latest).toEqual([{ status: 'unknown' }])
    act(() => tree.unmount())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    act(() => onChange({}))
    expect(latest).toEqual([{ status: 'unknown' }])
})

test('clears the previous user configuration on account change and rejects old callbacks', () => {
    const callbacks = []
    const unsubscribes = []
    watchGmailLabelingConfigs.mockImplementation((userId, onChange) => {
        callbacks.push(onChange)
        const unsubscribe = jest.fn()
        unsubscribes.push(unsubscribe)
        return unsubscribe
    })
    let tree
    act(() => {
        tree = renderer.create(<Probe />)
    })
    act(() => callbacks[0]({ gmailLabeling_project1: { enabled: true, syncIntervalMinutes: 60 } }))
    act(() => tree.update(<Probe loggedUser={{ ...user, uid: 'user2' }} />))
    expect(latest).toEqual([{ status: 'loading' }])
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1)
    act(() => callbacks[0]({}))
    expect(latest).toEqual([{ status: 'loading' }])
    act(() => callbacks[1]({}))
    expect(latest).toEqual([{ status: 'unconfigured' }])
    act(() => tree.unmount())
})

test.each([
    [user, []],
    [user, [{ ...connection, provider: 'microsoft' }]],
    [{ ...user, premium: { status: 'free' } }, [connection]],
])('does not subscribe when background checks cannot apply', (loggedUser, connections) => {
    let tree
    act(() => {
        tree = renderer.create(<Probe loggedUser={loggedUser} connections={connections} />)
    })
    expect(watchGmailLabelingConfigs).not.toHaveBeenCalled()
    act(() => tree.unmount())
})
