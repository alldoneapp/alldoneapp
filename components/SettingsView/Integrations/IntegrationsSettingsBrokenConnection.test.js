import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { ConnectionCard } from './IntegrationsSettings'
import { startServerSideAuth } from '../../../apis/google/GoogleOAuthServerSide'
import { startMicrosoftServerSideAuth } from '../../../apis/microsoft/MicrosoftOAuthServerSide'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))
jest.mock('../../UIControls/Button', () => {
    const React = require('react')
    return props => React.createElement('MockButton', props)
})
jest.mock('../../Icon', () => {
    const React = require('react')
    return props => React.createElement('MockIcon', props)
})
jest.mock('../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children }) => React.createElement('MockPopover', null, children)
})
jest.mock('../../UIComponents/FloatModals/ProjectListModal/ProjectListModal', () => () => null)
jest.mock('./ConnectionSettingsModal', () => () => null)
jest.mock('../../styles/global', () => ({
    __esModule: true,
    default: { subtitle1: {}, subtitle2: {}, body2: {}, caption1: {}, caption2: {}, title6: {} },
    hexColorToRGBa: () => 'rgba(0,0,0,0.24)',
    colors: {
        Text01: '#111',
        Text02: '#222',
        Text03: '#333',
        Grey300: '#ddd',
        Grey400: '#ccc',
        Primary100: '#00f',
        UtilityGreen100: '#efe',
        UtilityGreen300: '#080',
        UtilityYellow300: '#fa0',
        UtilityRed100: '#fee',
        UtilityRed150: '#faa',
        UtilityRed200: '#e00',
        UtilityRed300: '#b00',
    },
}))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, interpolations) => (interpolations ? `${key}:${JSON.stringify(interpolations)}` : key),
}))
// Pulls in redux/store (and with it half the app) through URLSystem.
jest.mock('../../../URLSystem/Settings/URLsSettings', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_SETTINGS_INTEGRATIONS: 'integrations',
}))
jest.mock('../../../utils/HelperFunctions', () => ({ popoverToSafePosition: () => ({}) }))
jest.mock('../../../redux/actions', () => ({ showFloatPopup: () => ({}), hideFloatPopup: () => ({}) }))
jest.mock('../../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn(async () => ({})) }))
jest.mock('../../../apis/google/GoogleOAuthServerSide', () => ({
    hasServerSideAuth: jest.fn(async () => ({ hasCredentials: true })),
    revokeServerSideAuth: jest.fn(async () => ({})),
    startServerSideAuth: jest.fn(async () => {}),
}))
jest.mock('../../../apis/microsoft/MicrosoftOAuthServerSide', () => ({
    hasMicrosoftServerSideAuth: jest.fn(async () => ({ hasCredentials: true })),
    revokeMicrosoftServerSideAuth: jest.fn(async () => ({})),
    startMicrosoftServerSideAuth: jest.fn(async () => {}),
}))

const PROJECTS = [{ id: 'project-1', name: 'Alldone Product' }]

function connection(overrides = {}) {
    return {
        connectionId: 'email_google_d6b44c7a',
        service: 'email',
        provider: 'google',
        email: 'karsten.wysk@gmail.com',
        defaultProjectId: 'project-1',
        isDefaultAccount: true,
        authInvalid: false,
        authInvalidAt: 0,
        legacy: false,
        ...overrides,
    }
}

function render(props) {
    let tree
    act(() => {
        tree = renderer.create(<ConnectionCard service="email" projects={PROJECTS} {...props} />)
    })
    return tree
}

function alert(tree) {
    return tree.root.findAll(node => node.props.testID === 'connection-auth-alert')[0]
}

function buttons(tree) {
    return tree.root.findAllByType('MockButton', { deep: false })
}

describe('ConnectionCard broken-account state (AT-2491)', () => {
    beforeEach(() => jest.clearAllMocks())

    test('a healthy account renders no reconnect state at all', () => {
        const tree = render({ connection: connection() })

        expect(alert(tree)).toBeUndefined()
        expect(JSON.stringify(tree.toJSON())).not.toContain('Reconnect required')
    })

    test('a revoked account states the failure, the consequence and the reconnect action', () => {
        const tree = render({ connection: connection({ authInvalid: true }) })
        const output = JSON.stringify(tree.toJSON())

        expect(alert(tree)).toBeDefined()
        expect(output).toContain('Reconnect required')
        // Naming the consequence is the point: "Reconnect account" alone never told the user
        // that mail had silently stopped being read.
        expect(output).toContain('ConnectionBrokenEmailConsequence')
        expect(buttons(tree).some(button => button.props.title === 'Reconnect account')).toBe(true)
    })

    test('a revoked calendar account names the calendar consequence, not the email one', () => {
        const tree = render({ service: 'calendar', connection: connection({ authInvalid: true }) })
        const output = JSON.stringify(tree.toJSON())

        expect(output).toContain('ConnectionBrokenCalendarConsequence')
        expect(output).not.toContain('ConnectionBrokenEmailConsequence')
    })

    test('a dead default account is badged as not connected, not just as the default', () => {
        // The green "Default account" badge on an otherwise normal card is exactly how a
        // four-day outage went unnoticed in production.
        const output = JSON.stringify(render({ connection: connection({ authInvalid: true }) }).toJSON())

        expect(output).toContain('Not connected')
        expect(output).toContain('Default account')
    })

    test('shows when the account stopped working, and for how long', () => {
        const fourDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000
        const output = JSON.stringify(
            render({ connection: connection({ authInvalid: true, authInvalidAt: fourDaysAgo }) }).toJSON()
        )

        expect(output).toContain('Stopped working on')
        // The translate() mock echoes its interpolations, so this asserts the day count the
        // user actually reads — not merely that some "days ago" string was rendered.
        expect(output).toContain('Amount days ago:{\\"amount\\":4}')
    })

    test('omits the "since" line when the breakage moment was never recorded', () => {
        // Connections flagged before AT-2491 started stamping authInvalidAt.
        const output = JSON.stringify(
            render({ connection: connection({ authInvalid: true, authInvalidAt: 0 }) }).toJSON()
        )

        expect(output).toContain('Reconnect required')
        expect(output).not.toContain('Stopped working on')
    })

    test('reconnecting re-runs consent for this exact connection, not a fresh account', () => {
        const tree = render({ connection: connection({ authInvalid: true }) })
        const reconnect = buttons(tree).find(button => button.props.title === 'Reconnect account')

        act(() => {
            reconnect.props.onPress()
        })

        expect(startServerSideAuth).toHaveBeenCalledWith('project-1', 'gmail', undefined, 'email_google_d6b44c7a')
    })

    test('a Microsoft account reconnects through the Microsoft flow', () => {
        const tree = render({
            connection: connection({
                authInvalid: true,
                provider: 'microsoft',
                connectionId: 'email_microsoft_1234abcd',
            }),
        })
        const reconnect = buttons(tree).find(button => button.props.title === 'Reconnect account')

        act(() => {
            reconnect.props.onPress()
        })

        expect(startMicrosoftServerSideAuth).toHaveBeenCalledWith(
            'project-1',
            'email',
            undefined,
            'email_microsoft_1234abcd'
        )
        expect(startServerSideAuth).not.toHaveBeenCalled()
    })

    test('a failed reconnect says so instead of looking like a dead button', async () => {
        startServerSideAuth.mockRejectedValueOnce(new Error('Failed to open OAuth popup'))
        const tree = render({ connection: connection({ authInvalid: true }) })
        const reconnect = buttons(tree).find(button => button.props.title === 'Reconnect account')

        await act(async () => {
            await reconnect.props.onPress()
        })

        expect(JSON.stringify(tree.toJSON())).toContain('Reconnecting failed. Please try again.')
    })
})
