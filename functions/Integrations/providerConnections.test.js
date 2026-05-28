'use strict'

const {
    buildCalendarConnectionUpdate,
    buildEmailConnectionUpdate,
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
})
