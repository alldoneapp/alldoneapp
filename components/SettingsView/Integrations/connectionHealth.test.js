import {
    brokenForDays,
    countBrokenConnections,
    formatBrokenSince,
    getBreakageConsequenceKey,
    isConnectionBroken,
    listBrokenConnections,
} from './connectionHealth'
import { buildConnectionId } from '../../../utils/IntegrationProviders'

const emailId = email => buildConnectionId('email', 'google', email)
const calendarId = email => buildConnectionId('calendar', 'google', email)

function storedConnection(email, overrides = {}) {
    return {
        provider: 'google',
        emailAddress: email,
        defaultProjectId: 'project-1',
        isDefaultAccount: false,
        authInvalid: false,
        ...overrides,
    }
}

describe('isConnectionBroken', () => {
    test('only an explicit true counts as broken', () => {
        expect(isConnectionBroken({ authInvalid: true })).toBe(true)
        expect(isConnectionBroken({ authInvalid: false })).toBe(false)
        // A connection whose flag never made it through the mapper must not read as broken —
        // that would put every healthy account into the reconnect state.
        expect(isConnectionBroken({})).toBe(false)
        expect(isConnectionBroken(null)).toBe(false)
        expect(isConnectionBroken(undefined)).toBe(false)
    })
})

describe('listBrokenConnections / countBrokenConnections', () => {
    const loggedUser = {
        emailConnections: {
            [emailId('a@gmail.com')]: storedConnection('a@gmail.com', { authInvalid: true }),
            [emailId('b@gmail.com')]: storedConnection('b@gmail.com'),
        },
        calendarConnections: {
            [calendarId('a@gmail.com')]: storedConnection('a@gmail.com', { authInvalid: true }),
        },
    }

    test('collects broken accounts across email and calendar', () => {
        const broken = listBrokenConnections(loggedUser)

        expect(broken).toHaveLength(2)
        expect(broken.map(connection => connection.service)).toEqual(['email', 'calendar'])
        expect(countBrokenConnections(loggedUser)).toBe(2)
    })

    test('counts nothing for a healthy workspace', () => {
        expect(
            countBrokenConnections({
                emailConnections: { [emailId('b@gmail.com')]: storedConnection('b@gmail.com') },
            })
        ).toBe(0)
    })

    test('counts nothing for a user with no connections at all', () => {
        expect(countBrokenConnections({})).toBe(0)
        expect(countBrokenConnections()).toBe(0)
    })

    test('a legacy apisConnected-only user never reports a false alarm', () => {
        // The synthesis path cannot know about revocation and hardcodes false. It must stay
        // that way: inventing "broken" there would badge every pre-migration account.
        expect(
            countBrokenConnections({
                apisConnected: { 'project-1': { gmail: true, gmailEmail: 'a@gmail.com' } },
            })
        ).toBe(0)
    })
})

describe('getBreakageConsequenceKey', () => {
    test('names the consequence per service, not a generic failure', () => {
        expect(getBreakageConsequenceKey('email')).toBe('ConnectionBrokenEmailConsequence')
        expect(getBreakageConsequenceKey('calendar')).toBe('ConnectionBrokenCalendarConsequence')
    })
})

describe('formatBrokenSince', () => {
    const now = Date.UTC(2026, 8, 2, 12, 0, 0)

    test('formats a known breakage moment', () => {
        expect(formatBrokenSince(Date.UTC(2026, 7, 29, 10, 59, 5), now)).toBe('Aug 29, 2026')
    })

    test('renders nothing when the moment is unknown', () => {
        // Absent is not the epoch: "since Jan 1, 1970" is worse than saying nothing.
        expect(formatBrokenSince(0, now)).toBeNull()
        expect(formatBrokenSince(undefined, now)).toBeNull()
        expect(formatBrokenSince(NaN, now)).toBeNull()
    })

    test('renders nothing for a timestamp in the future', () => {
        expect(formatBrokenSince(now + 60_000, now)).toBeNull()
    })
})

describe('brokenForDays', () => {
    const now = Date.UTC(2026, 8, 2, 12, 0, 0)

    test('reports whole days since the breakage', () => {
        expect(brokenForDays(Date.UTC(2026, 7, 29, 10, 59, 5), now)).toBe(4)
    })

    test('reports 0 on the day it broke, so no "0 days ago" hint is rendered', () => {
        expect(brokenForDays(now - 60_000, now)).toBe(0)
    })

    test('reports nothing when the moment is unknown or in the future', () => {
        expect(brokenForDays(0, now)).toBeNull()
        expect(brokenForDays(now + 60_000, now)).toBeNull()
    })
})
