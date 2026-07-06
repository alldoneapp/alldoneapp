/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import EmailLine from './EmailLine'
import { getEmailLineTodayKey } from './emailLineHelper'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector(mockState)),
}))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(textKey => textKey),
}))

jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({
    fetchEmailLineSummary: jest.fn(),
}))

jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    setUserEmailLineHiddenToday: jest.fn(),
    clearUserEmailLineHiddenToday: jest.fn(),
}))

jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { processURLProjectDetailsTab: jest.fn() },
}))

jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))

jest.mock('./EmailLabelChip', () => ({
    __esModule: true,
    default: ({ label }) => {
        const React = require('react')
        const { Text, View } = require('react-native')
        return (
            <View testID="chip">
                <Text>{`${label.displayName}:${label.unreadCount}`}</Text>
            </View>
        )
    },
}))

const projectId = 'project-1'

let mockState

const createState = ({
    apisConnected = { [projectId]: { email: true, emailProvider: 'google' } },
    summary,
    hiddenToday,
} = {}) => ({
    loggedUser: {
        uid: 'user-1',
        timezone: 0,
        apisConnected,
        emailLineHiddenTodayByProject: hiddenToday ? { [projectId]: hiddenToday } : {},
    },
    smallScreenNavigation: false,
    emailLineSummaryByProject: summary ? { [projectId]: summary } : {},
})

const textNodes = tree =>
    tree.root.findAllByType(Text).map(node => {
        const children = node.props.children
        return Array.isArray(children) ? children.join('') : children
    })

describe('EmailLine', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState = createState()
    })

    it('renders nothing when email is not connected', () => {
        mockState = createState({ apisConnected: {} })
        const tree = renderer.create(<EmailLine projectId={projectId} inAllProjects={false} />).toJSON()
        expect(tree).toBeNull()
    })

    it('renders label chips when there are unread labels', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labels: [
                    { labelId: 'INBOX', displayName: 'Inbox', unreadCount: 3, kind: 'inbox' },
                    { labelId: 'Label_ads', displayName: 'Ads', unreadCount: 7, kind: 'user' },
                ],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine projectId={projectId} inAllProjects={false} />)
        const rendered = textNodes(tree)
        expect(rendered).toContain('Inbox:3')
        expect(rendered).toContain('Ads:7')
    })

    it('shows the Inbox Zero state when there are no unread labels', () => {
        mockState = createState({
            summary: {
                connected: true,
                provider: 'google',
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', unreadCount: 0, kind: 'inbox' }],
                inboxZero: true,
            },
        })
        const tree = renderer.create(<EmailLine projectId={projectId} inAllProjects={false} />)
        expect(textNodes(tree).some(text => typeof text === 'string' && text.includes('Inbox Zero'))).toBe(true)
    })

    it('collapses to a Show again affordance when done for today (hides emails)', () => {
        const todayKey = getEmailLineTodayKey({ timezone: 0 })
        mockState = createState({
            hiddenToday: todayKey,
            summary: {
                connected: true,
                provider: 'google',
                labels: [{ labelId: 'INBOX', displayName: 'Inbox', unreadCount: 3, kind: 'inbox' }],
                inboxZero: false,
            },
        })
        const tree = renderer.create(<EmailLine projectId={projectId} inAllProjects={false} />)
        // Emails are hidden; only a "Show again" affordance remains.
        expect(textNodes(tree)).toContain('Show again')
        expect(tree.root.findAllByProps({ testID: 'chip' })).toHaveLength(0)
    })

    it('also collapses (does not vanish) in All Projects when done for today', () => {
        const todayKey = getEmailLineTodayKey({ timezone: 0 })
        mockState = createState({ hiddenToday: todayKey, summary: { connected: true, labels: [] } })
        const tree = renderer.create(<EmailLine projectId={projectId} inAllProjects />)
        expect(textNodes(tree)).toContain('Show again')
    })

    it('shows a Reconnect email state when auth expired', () => {
        mockState = createState({
            summary: { connected: true, provider: '', labels: [], authExpired: true, inboxZero: false },
        })
        const tree = renderer.create(<EmailLine projectId={projectId} inAllProjects={false} />)
        expect(textNodes(tree)).toContain('Reconnect email')
    })
})
