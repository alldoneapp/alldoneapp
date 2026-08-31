import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useEmailLabelGroups from './useEmailLabelGroups'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'

const mockState = {
    loggedUser: {
        emailConnections: {
            email_google_11111111: {
                provider: 'google',
                emailAddress: 'healthy@example.com',
                authInvalid: false,
            },
            email_google_22222222: {
                provider: 'google',
                emailAddress: 'expired@example.com',
                authInvalid: true,
            },
        },
    },
    emailLineSummaryByProject: {},
}

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ fetchEmailLineSummary: jest.fn() }))

const Harness = () => {
    useEmailLabelGroups()
    return null
}

describe('useEmailLabelGroups', () => {
    beforeEach(() => {
        fetchEmailLineSummary.mockClear()
        mockState.loggedUser.emailConnections.email_google_22222222.authInvalid = true
    })

    test('fetches healthy connections without repeatedly calling an expired account', () => {
        let tree
        act(() => {
            tree = renderer.create(<Harness />)
        })

        expect(fetchEmailLineSummary).toHaveBeenCalledTimes(1)
        expect(fetchEmailLineSummary).toHaveBeenCalledWith('email_google_11111111')
        tree.unmount()
    })

    test('fetches a connection after it is reconnected', () => {
        let tree
        act(() => {
            tree = renderer.create(<Harness />)
        })
        fetchEmailLineSummary.mockClear()

        mockState.loggedUser.emailConnections.email_google_22222222.authInvalid = false
        act(() => {
            tree.update(<Harness />)
        })

        expect(fetchEmailLineSummary).toHaveBeenCalledWith('email_google_22222222')
        tree.unmount()
    })
})
