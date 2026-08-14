import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CalendarSyncButton from './CalendarSyncButton'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('./ReloadCalendar', () => 'ReloadCalendar')
jest.mock('../../utils/backends/firestore', () => ({
    checkIfCalendarConnected: jest.fn(),
}))

// AT-2252 - the calendar re-sync used to live in the dedicated calendar section header. It now sits
// on the day header, and only for a project that actually has a calendar connected.
describe('CalendarSyncButton', () => {
    const render = projectId => {
        let tree
        act(() => {
            tree = renderer.create(<CalendarSyncButton projectId={projectId} />)
        })
        return tree
    }

    beforeEach(() => {
        mockState = {
            loggedUser: {
                apisConnected: {
                    'project-with-calendar': { calendar: true, calendarEmail: 'karsten@example.com' },
                    'project-without-calendar': { gmail: true },
                },
            },
        }
    })

    it('renders the sync control for a project with a connected calendar', () => {
        const tree = render('project-with-calendar')

        const reload = tree.root.findByType('ReloadCalendar')
        expect(reload.props.projectId).toBe('project-with-calendar')
    })

    it('renders nothing for a project without a connected calendar', () => {
        expect(render('project-without-calendar').root.findAllByType('ReloadCalendar')).toHaveLength(0)
    })

    it('renders nothing for an unknown project or when no apis are connected', () => {
        expect(render('project-never-seen').root.findAllByType('ReloadCalendar')).toHaveLength(0)

        mockState = { loggedUser: {} }
        expect(render('project-with-calendar').root.findAllByType('ReloadCalendar')).toHaveLength(0)
    })
})
