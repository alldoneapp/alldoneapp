'use strict'

const {
    buildCalendarConnectionUpdate,
    buildConnectionId,
    buildEmailConnectionUpdate,
    findConnectionsForProject,
    getConnection,
    listCalendarConnections,
    listEmailConnections,
    resolveCalendarConnection,
    resolveEmailConnection,
} = require('./providerConnections')

describe('providerConnections', () => {
    test('resolves legacy Gmail connections as Google email', () => {
        expect(resolveEmailConnection({ gmail: true, gmailEmail: 'Person@Example.com', gmailDefault: true })).toEqual({
            connected: true,
            provider: 'google',
            emailAddress: 'person@example.com',
            isDefault: true,
        })
    })

    test('resolves Microsoft email metadata', () => {
        expect(
            resolveEmailConnection({
                email: true,
                emailProvider: 'microsoft',
                emailAddress: 'Person@Example.com',
                emailDefault: true,
            })
        ).toEqual({
            connected: true,
            provider: 'microsoft',
            emailAddress: 'person@example.com',
            isDefault: true,
        })
    })

    test('builds Google email update with legacy Gmail fields', () => {
        expect(buildEmailConnectionUpdate('project-1', 'google', 'Person@Example.com', true)).toEqual({
            'apisConnected.project-1.email': true,
            'apisConnected.project-1.emailProvider': 'google',
            'apisConnected.project-1.emailAddress': 'person@example.com',
            'apisConnected.project-1.emailDefault': true,
            'apisConnected.project-1.gmail': true,
            'apisConnected.project-1.gmailEmail': 'person@example.com',
            'apisConnected.project-1.gmailDefault': true,
        })
    })

    test('builds Microsoft email update that disables legacy Gmail flags', () => {
        expect(buildEmailConnectionUpdate('project-1', 'microsoft', 'Person@Example.com', false)).toEqual({
            'apisConnected.project-1.email': true,
            'apisConnected.project-1.emailProvider': 'microsoft',
            'apisConnected.project-1.emailAddress': 'person@example.com',
            'apisConnected.project-1.emailDefault': false,
            'apisConnected.project-1.gmail': false,
            'apisConnected.project-1.gmailDefault': false,
        })
    })

    test('resolves calendar provider metadata with Google fallback', () => {
        expect(resolveCalendarConnection({ calendar: true, calendarEmail: 'Person@Example.com' })).toEqual({
            connected: true,
            provider: 'google',
            emailAddress: 'person@example.com',
            isDefault: false,
        })

        expect(buildCalendarConnectionUpdate('project-1', 'microsoft', 'Person@Example.com', true)).toEqual({
            'apisConnected.project-1.calendar': true,
            'apisConnected.project-1.calendarProvider': 'microsoft',
            'apisConnected.project-1.calendarEmail': 'person@example.com',
            'apisConnected.project-1.calendarDefault': true,
        })
    })

    test('buildConnectionId is deterministic, normalized, and field-path safe', () => {
        const id = buildConnectionId('email', 'google', 'Person@Example.com')
        expect(id).toBe(buildConnectionId('email', 'google', '  person@example.com  '))
        expect(id).toMatch(/^email_google_[0-9a-f]{8}$/)
        expect(buildConnectionId('calendar', 'microsoft', 'person@example.com')).toMatch(
            /^calendar_microsoft_[0-9a-f]{8}$/
        )
        expect(buildConnectionId('email', 'google', 'other@example.com')).not.toBe(id)
    })

    test('reads stored account-level connection maps when present', () => {
        const connectionId = buildConnectionId('email', 'google', 'me@gmail.com')
        const userData = {
            emailConnections: {
                [connectionId]: {
                    provider: 'google',
                    emailAddress: 'me@gmail.com',
                    defaultProjectId: 'p1',
                    isDefaultAccount: true,
                },
            },
            // Legacy data must be ignored once the new map exists.
            apisConnected: { p2: { gmail: true, gmailEmail: 'old@gmail.com' } },
        }

        const connections = listEmailConnections(userData)
        expect(connections).toHaveLength(1)
        expect(connections[0]).toMatchObject({
            connectionId,
            provider: 'google',
            emailAddress: 'me@gmail.com',
            defaultProjectId: 'p1',
            isDefaultAccount: true,
            legacy: false,
        })
        expect(getConnection(userData, 'email', connectionId)).toMatchObject({ emailAddress: 'me@gmail.com' })
    })

    test('synthesizes connections from legacy apisConnected, grouping same account across projects', () => {
        const userData = {
            apisConnected: {
                p1: { gmail: true, gmailEmail: 'me@gmail.com' },
                p2: { gmail: true, gmailEmail: 'me@gmail.com', gmailDefault: true },
                p3: {
                    email: true,
                    emailProvider: 'microsoft',
                    emailAddress: 'me@outlook.com',
                    calendar: true,
                    calendarEmail: 'me@gmail.com',
                },
            },
        }

        const emailConnections = listEmailConnections(userData)
        expect(emailConnections).toHaveLength(2)
        const google = emailConnections.find(connection => connection.provider === 'google')
        // The project holding the legacy default flag wins the defaultProjectId.
        expect(google).toMatchObject({ defaultProjectId: 'p2', isDefaultAccount: true, legacy: true })

        const calendarConnections = listCalendarConnections(userData)
        expect(calendarConnections).toHaveLength(1)
        expect(calendarConnections[0]).toMatchObject({ provider: 'google', defaultProjectId: 'p3' })
    })

    test('findConnectionsForProject resolves legacy entries whose account grouped elsewhere', () => {
        const userData = {
            apisConnected: {
                p1: { gmail: true, gmailEmail: 'me@gmail.com', gmailDefault: true },
                p2: { gmail: true, gmailEmail: 'me@gmail.com' },
            },
        }

        // p2's synthesized connection has defaultProjectId p1 (default flag), but a
        // pre-migration caller passing p2 must still find the account.
        const matches = findConnectionsForProject(userData, 'email', 'p2')
        expect(matches).toHaveLength(1)
        expect(matches[0].emailAddress).toBe('me@gmail.com')
        expect(findConnectionsForProject(userData, 'email', 'p_unknown')).toEqual([])
    })
})
