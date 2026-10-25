/**
 * @jest-environment jsdom
 */

// AT-2276: an unregistered visitor opening a public meeting link (/meet/<slug>) must land on the
// booking page, never on the login ("you are not registered") screen. These tests pin the URL
// classification and the routing that the boot path relies on.

import NavigationService from '../../utils/NavigationService'
import SharedHelper from '../../utils/SharedHelper'
import URLTrigger from '../../URLSystem/URLTrigger'
import URLsBookingTrigger from '../../URLSystem/Booking/URLsBookingTrigger'

jest.mock('../../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/firestore'),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://localhost:1234' }),
}))

describe('SharedHelper.matchesPublicPageUrl', () => {
    it('matches a public meeting booking link', () => {
        expect(SharedHelper.matchesPublicPageUrl('/meet/karsten-wysk')).toBe(true)
    })

    it('matches it with a query string or hash appended', () => {
        expect(SharedHelper.matchesPublicPageUrl('/meet/karsten-wysk?utm_source=signature')).toBe(true)
        expect(SharedHelper.matchesPublicPageUrl('/meet/karsten-wysk#top')).toBe(true)
    })

    it('matches an absolute URL on the same origin', () => {
        expect(SharedHelper.matchesPublicPageUrl(`${window.location.origin}/meet/karsten-wysk`)).toBe(true)
    })

    it('does not match anything else - access control for other routes is untouched', () => {
        expect(SharedHelper.matchesPublicPageUrl('/meet/')).toBe(false)
        expect(SharedHelper.matchesPublicPageUrl('/meet/karsten-wysk/edit')).toBe(false)
        expect(SharedHelper.matchesPublicPageUrl('/login')).toBe(false)
        expect(SharedHelper.matchesPublicPageUrl('/starttrial')).toBe(false)
        expect(SharedHelper.matchesPublicPageUrl('/projects/p1/tasks/open')).toBe(false)
        expect(SharedHelper.matchesPublicPageUrl('/projects/p1/user/u1/tasks/t1')).toBe(false)
        expect(SharedHelper.matchesPublicPageUrl(undefined)).toBe(false)
    })
})

describe('Booking URL routing', () => {
    beforeEach(() => {
        NavigationService.navigate('LoginScreen')
    })

    it('routes a meeting link straight to the booking page', () => {
        URLTrigger.directProcessUrl(NavigationService, '/meet/karsten-wysk')

        const state = NavigationService.getCurrentState()
        expect(state.routeName).toBe('MeetingBooking')
        expect(state.params).toEqual({ slug: 'karsten-wysk' })
    })

    it('does not remount the booking page when the same link is processed again', () => {
        URLTrigger.directProcessUrl(NavigationService, '/meet/karsten-wysk')
        const { id } = NavigationService.getCurrentState()

        // The boot path resolves the URL before Firebase auth answers, and the auth callback
        // processes it again right after: the second pass must be a no-op.
        URLTrigger.directProcessUrl(NavigationService, '/meet/karsten-wysk')

        expect(NavigationService.getCurrentState().id).toBe(id)
    })

    it('still navigates when the slug changes', () => {
        URLsBookingTrigger.trigger(NavigationService, '/meet/karsten-wysk')
        const { id } = NavigationService.getCurrentState()

        URLsBookingTrigger.trigger(NavigationService, '/meet/daniela')

        const state = NavigationService.getCurrentState()
        expect(state.id).not.toBe(id)
        expect(state.params).toEqual({ slug: 'daniela' })
    })
})
