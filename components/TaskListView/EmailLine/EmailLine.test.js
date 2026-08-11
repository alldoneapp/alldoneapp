/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailLine from './EmailLine'
import { EMAIL_LINE_NO_LABEL_ID, getEmailLineTodayKey } from './emailLineHelper'
import { buildConnectionId } from '../../../utils/IntegrationProviders'
import SettingsHelper from '../../SettingsView/SettingsHelper'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector(mockState)),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(textKey => textKey),
}))

// Exercise the preserved UI while the production feature switch is off.
jest.mock('./emailLineFeature', () => ({ EMAIL_LINE_ENABLED: true }))

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({
    fetchEmailLineSummary: jest.fn(),
}))

jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    setUserEmailLineHiddenTodayForConnections: jest.fn(),
    clearUserEmailLineHiddenTodayForConnections: jest.fn(),
}))

// SettingsHelper transitively imports the redux store (react-hot-keys), which jest
// cannot transform.
jest.mock('../../SettingsView/SettingsHelper', () => ({
    __esModule: true,
    default: { processURLSettingsTab: jest.fn() },
}))

jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))

jest.mock('./EmailLabelChip', () => ({
    __esModule: true,
    default: ({ group }) => {
        const React = require('react')
        const { Text, View } = require('react-native')
        return (
            <View testID="chip">
                <Text>{`${group.displayName}:${group.threadCount}${group.sweeping ? ':sweeping' : ''}`}</Text>
            </View>
        )
    },
}))

const projectId = 'project-1'
const accountEmail = 'me@gmail.com'
const connectionId = buildConnectionId('email', 'google', accountEmail)

let mockState

const createState = ({
    apisConnected = { [projectId]: { email: true, emailProvider: 'google', gmailEmail: accountEmail } },
    summary,
    hiddenToday,
} = {}) => ({
    loggedUser: {
        uid: 'user-1',
        timezone: 0,
        apisConnected,
        emailLineHiddenTodayByConnection: hiddenToday ? { [connectionId]: hiddenToday } : {},
    },
    smallScreenNavigation: false,
    emailLineSummaryByProject: summary ? { [connectionId]: summary } : {},
})

const textNodes = tree =>
    tree.root.findAllByType(Text).map(node => {
        const children = node.props.children
        return Array.isArray(children) ? children.join('') : children
    })

const findButtonByLabel = (tree, label) =>
    tree.root.findAllByType(TouchableOpacity).find(node => node.props.accessibilityLabel === label)

const hasLiveDot = tree => tree.root.findAllByProps({ accessibilityLabel: 'Email labeling active' }).length > 0

describe('EmailLine', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = createState()
    })

    it('renders nothing when email is not connected', () => {
        mockState = createState({ apisConnected: {} })
        const tree = renderer.create(<EmailLine />).toJSON()
        expect(tree).toBeNull()
    })

    it('renders merged label chips with thread counts', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labels: [
                    { labelId: 'INBOX', displayName: 'Inbox', threadCount: 3, unreadCount: 2, kind: 'inbox' },
                    { labelId: 'Label_ads', displayName: 'Ads', threadCount: 7, unreadCount: 7, kind: 'user' },
                    {
                        labelId: EMAIL_LINE_NO_LABEL_ID,
                        displayName: 'No label',
                        threadCount: 2,
                        unreadCount: 1,
                        kind: 'no_label',
                    },
                ],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine />)
        const rendered = textNodes(tree)
        expect(rendered).toContain('Inbox:9')
        expect(rendered).toContain('Ads:7')
        expect(rendered).toContain('No label:2')
    })

    it('falls back to unread counts for summaries without threadCount', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labels: [{ labelId: 'Label_ads', displayName: 'Ads', unreadCount: 5, kind: 'user' }],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine />)
        expect(textNodes(tree)).toContain('Ads:5')
    })

    it('shows the Inbox Zero state when there are no inbox threads', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', threadCount: 0, unreadCount: 0, kind: 'inbox' }],
                inboxZero: true,
            },
        })
        const tree = renderer.create(<EmailLine />)
        expect(textNodes(tree).some(text => typeof text === 'string' && text.includes('Inbox Zero'))).toBe(true)
    })

    it('keeps a sweeping label visible while its counts are optimistically zeroed', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labels: [
                    {
                        labelId: 'Label_ads',
                        displayName: 'Ads',
                        threadCount: 0,
                        unreadCount: 0,
                        sweeping: true,
                        kind: 'user',
                    },
                ],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine />)
        expect(textNodes(tree)).toContain('Ads:0:sweeping')
    })

    it('shows the pulsating live dot while labeling is active', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labelingEnabled: true,
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', threadCount: 3, unreadCount: 2, kind: 'inbox' }],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine />)
        expect(hasLiveDot(tree)).toBe(true)
    })

    it('hides the live dot when labeling is not enabled', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labelingEnabled: false,
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', threadCount: 3, unreadCount: 2, kind: 'inbox' }],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine />)
        expect(hasLiveDot(tree)).toBe(false)
    })

    it('disappears completely when done for today', () => {
        const todayKey = getEmailLineTodayKey({ timezone: 0 })
        mockState = createState({
            hiddenToday: todayKey,
            summary: {
                connected: true,
                provider: 'google',
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', threadCount: 3, unreadCount: 3, kind: 'inbox' }],
                inboxZero: false,
            },
        })
        // The way back is "Show email line" in the All Projects "..." menu.
        const tree = renderer.create(<EmailLine />).toJSON()
        expect(tree).toBeNull()
    })

    it('shows a Reconnect email state when auth expired', () => {
        mockState = createState({
            summary: { connected: true, provider: '', labels: [], authExpired: true, inboxZero: false },
        })
        const tree = renderer.create(<EmailLine />)
        expect(textNodes(tree)).toContain('Reconnect email')
    })

    it('opens Integrations settings from the settings button', () => {
        const tree = renderer.create(<EmailLine />)
        const settingsButton = findButtonByLabel(tree, 'Settings')

        act(() => settingsButton.props.onPress())

        expect(SettingsHelper.processURLSettingsTab).toHaveBeenCalledWith(
            NavigationService,
            DV_TAB_SETTINGS_INTEGRATIONS
        )
    })

    it('merges same-named labels of multiple accounts into one chip', () => {
        const secondEmail = 'work@outlook.com'
        const secondConnectionId = buildConnectionId('email', 'microsoft', secondEmail)
        mockState = {
            loggedUser: {
                uid: 'user-1',
                timezone: 0,
                emailConnections: {
                    [connectionId]: {
                        provider: 'google',
                        emailAddress: accountEmail,
                        defaultProjectId: projectId,
                        isDefaultAccount: true,
                    },
                    [secondConnectionId]: {
                        provider: 'microsoft',
                        emailAddress: secondEmail,
                        defaultProjectId: 'project-2',
                    },
                },
                emailLineHiddenTodayByConnection: {},
            },
            smallScreenNavigation: false,
            emailLineSummaryByProject: {
                [connectionId]: {
                    connected: true,
                    provider: 'google',
                    emailAddress: accountEmail,
                    labels: [
                        { labelId: 'INBOX', displayName: 'Inbox', threadCount: 20, unreadCount: 2, kind: 'inbox' },
                        { labelId: 'Label_ads', displayName: 'Ads', threadCount: 2, unreadCount: 2, kind: 'user' },
                    ],
                },
                [secondConnectionId]: {
                    connected: true,
                    provider: 'microsoft',
                    emailAddress: secondEmail,
                    labels: [
                        { labelId: 'f_inbox', displayName: 'Inbox', threadCount: 50, unreadCount: 1, kind: 'inbox' },
                        { labelId: 'f_ads', displayName: 'Ads', threadCount: 5, unreadCount: 1, kind: 'folder' },
                    ],
                },
            },
        }
        const tree = renderer.create(<EmailLine />)
        const rendered = textNodes(tree)
        expect(rendered).toContain('Inbox:7')
        expect(rendered).toContain('Ads:7')
        expect(rendered).not.toContain('Inbox:20')
        expect(rendered).not.toContain('Inbox:50')
        // No per-account captions on the unified line anymore.
        expect(rendered).not.toContain(accountEmail)
        expect(rendered).not.toContain(secondEmail)
    })
})
