import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ActivityIndicator, Text } from 'react-native'
import { useSelector } from 'react-redux'

import ChatsEmailConnectionStatus from './ChatsEmailConnectionStatus'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { watchGmailLabelingConfigs } from '../../utils/backends/Gmail/gmailLabelingFirestore'
import SettingsHelper from '../SettingsView/SettingsHelper'
import NavigationService from '../../utils/NavigationService'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../utils/TabNavigationConstants'
import { setLanguage } from '../../i18n/TranslationService'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../Icon', () => 'Icon')
jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('../../utils/backends/Gmail/gmailLabelingFirestore', () => ({ watchGmailLabelingConfigs: jest.fn() }))
jest.mock('../SettingsView/SettingsHelper', () => ({ __esModule: true, default: { processURLSettingsTab: jest.fn() } }))
jest.mock('../../URLSystem/Settings/URLsSettings', () => ({
    __esModule: true,
    default: { getPath: () => 'settings/integrations' },
    URL_SETTINGS_INTEGRATIONS: 'SETTINGS_INTEGRATIONS',
}))

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
        .flatMap(node => node.props.children)
        .filter(value => typeof value === 'string')
        .join(' ')

beforeEach(() => {
    jest.clearAllMocks()
    loggedUser = {
        uid: 'user1',
        premium: { status: 'premium' },
        emailConnections: { [connectionId]: { provider: 'google', emailAddress: 'a@gmail.com' } },
    }
    setLanguage('en')
    watchGmailLabelingConfigs.mockImplementation((userId, onChange) => {
        onChange({ [`gmailLabeling_${connectionId}`]: { enabled: true, syncIntervalMinutes: 60 } })
        return jest.fn()
    })
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
    expect(statusText(tree)).toContain('Background check: about every 60 minutes.')
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
    expect(watchGmailLabelingConfigs).not.toHaveBeenCalled()
    expect(tree.toJSON()).toBeNull()
})

test('displays changes to the configured cadence while checking and opens Integrations', () => {
    runHttpsCallableFunction.mockReturnValue(new Promise(() => {}))
    let onChange
    watchGmailLabelingConfigs.mockImplementation((userId, callback) => {
        onChange = callback
        return jest.fn()
    })
    const tree = renderStatus()
    expect(statusText(tree)).toContain('Loading background check settings')
    act(() => onChange({ [`gmailLabeling_${connectionId}`]: { enabled: true, syncIntervalMinutes: 90 } }))
    expect(statusText(tree)).toContain('about every 90 minutes')
    act(() => onChange({ [`gmailLabeling_${connectionId}`]: { enabled: true, syncIntervalMinutes: 5 } }))
    expect(statusText(tree)).toContain('about every 30 minutes')

    const link = tree.root.findAllByType(Text).find(node => node.props.accessibilityRole === 'link')
    expect(link.props.href).toBe('/settings/integrations')
    const preventDefault = jest.fn()
    act(() => link.props.onPress({ preventDefault }))
    expect(preventDefault).toHaveBeenCalled()
    expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
})

test.each([
    [{}, 'not configured'],
    [{ [`gmailLabeling_${connectionId}`]: { enabled: false, syncIntervalMinutes: 60 } }, 'disabled'],
])('does not advertise a cadence for missing or disabled configuration', (configs, expected) => {
    runHttpsCallableFunction.mockReturnValue(new Promise(() => {}))
    watchGmailLabelingConfigs.mockImplementation((userId, callback) => {
        callback(configs)
        return jest.fn()
    })
    const tree = renderStatus()
    expect(statusText(tree)).toContain(expected)
    expect(statusText(tree)).not.toContain('about every')
})

test('renders German cadence and settings link, including differing cadences per account', () => {
    setLanguage('de')
    const secondId = 'email_google_bbbbbbbb'
    loggedUser.emailConnections[secondId] = { provider: 'google', emailAddress: 'b@gmail.com' }
    runHttpsCallableFunction.mockReturnValue(new Promise(() => {}))
    watchGmailLabelingConfigs.mockImplementation((userId, callback) => {
        callback({
            [`gmailLabeling_${connectionId}`]: { enabled: true, syncIntervalMinutes: 45 },
            [`gmailLabeling_${secondId}`]: { enabled: true, syncIntervalMinutes: 120 },
        })
        return jest.fn()
    })
    const tree = renderStatus()
    expect(statusText(tree)).toContain('E-Mail-Verbindungen werden geprüft…')
    expect(statusText(tree)).toContain('a@gmail.com: Hintergrundprüfung: ca. alle 45 Minuten.')
    expect(statusText(tree)).toContain('b@gmail.com: Hintergrundprüfung: ca. alle 120 Minuten.')
    expect(statusText(tree)).toContain('Einstellungen → Integrationen')
})

test('does not advertise automatic checking for a revoked connection', async () => {
    runHttpsCallableFunction.mockResolvedValue({ results: [{ connectionId, status: 'reconnect_required' }] })
    const tree = renderStatus()
    await act(async () => {})
    expect(statusText(tree)).toContain('paused until the account is reconnected')
    expect(statusText(tree)).not.toContain('about every')
})
