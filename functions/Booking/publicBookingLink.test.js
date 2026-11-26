'use strict'

// AT-3161 follow-up: what an agent that opened a booking page with the browser tools is told.

const { attachBookingPageBrowserHint, getBookingPageLinkFromUrl, resolveBookingSlug } = require('./publicBookingLink')

const BOOKING_URL = 'https://my.alldone.app/meet/karsten-wysk'

describe('booking page hint on browser results', () => {
    test.each([
        [BOOKING_URL, BOOKING_URL],
        ['https://my.alldone.app/meet/Karsten-Wysk/?utm=x#top', BOOKING_URL],
        ['https://evil.example/meet/karsten-wysk', null],
        ['https://mystaging.alldone.app/meet/karsten-wysk', null],
        ['https://my.alldone.app/meet/karsten-wysk/llms.txt', null],
        ['https://my.alldone.app/api/booking/mcp/karsten-wysk', null],
        ['https://my.alldone.app/projects/p1/tasks/t1', null],
        ['not a url', null],
        ['', null],
    ])('the booking page of %s is %s', (url, expected) => {
        expect(getBookingPageLinkFromUrl(url)).toBe(expected)
    })

    test('a completed step on a booking page names the booking tools and what to do without them', () => {
        const result = attachBookingPageBrowserHint(
            { success: true, action: 'navigate', url: BOOKING_URL, text: 'Book a meeting' },
            { toolName: 'browser_navigate', toolArgs: { url: BOOKING_URL } }
        )
        expect(result.text).toBe('Book a meeting')
        expect(result.bookingPage.bookingUrl).toBe(BOOKING_URL)
        expect(result.bookingPage.tools).toEqual([
            'get_public_booking_page',
            'find_public_booking_times',
            'book_public_meeting',
        ])
        const { instruction } = result.bookingPage
        expect(instruction).toMatch(/Do not click or fill it in/)
        expect(instruction).toMatch(/need no confirmation/)
        expect(instruction).toMatch(/only after the user confirmed exactly that slot/)
        expect(instruction).toMatch(/do not book in the browser/)
        expect(instruction).toMatch(/refresh or reconnect the Alldone connector/)
    })

    test('the final URL counts (a redirect onto the page), and the navigate argument when the worker gave none', () => {
        expect(
            attachBookingPageBrowserHint(
                { success: true, url: 'https://my.alldone.app/m', finalUrl: BOOKING_URL },
                { toolName: 'browser_navigate' }
            ).bookingPage
        ).toBeDefined()
        expect(
            attachBookingPageBrowserHint(
                { success: true },
                { toolName: 'browser_navigate', toolArgs: { url: BOOKING_URL } }
            ).bookingPage
        ).toBeDefined()
        // Other actions only on what the page actually is.
        expect(
            attachBookingPageBrowserHint(
                { success: true },
                { toolName: 'browser_click', toolArgs: { url: BOOKING_URL } }
            ).bookingPage
        ).toBeUndefined()
    })

    test('approval-gated, refused and failed steps are returned exactly as they were', () => {
        const gated = {
            success: false,
            status: 'approval_required',
            approvalId: 'a1',
            url: BOOKING_URL,
            instruction: 'Tell the user exactly what you are about to do and that it needs their approval, then stop.',
        }
        expect(attachBookingPageBrowserHint(gated, { toolName: 'browser_click' })).toBe(gated)
        const failed = { success: false, error: 'boom' }
        expect(
            attachBookingPageBrowserHint(failed, { toolName: 'browser_navigate', toolArgs: { url: BOOKING_URL } })
        ).toBe(failed)
        expect(attachBookingPageBrowserHint(null, {})).toBeNull()
    })

    test('other pages are left alone', () => {
        const other = { success: true, url: 'https://example.com/meet/karsten-wysk' }
        expect(attachBookingPageBrowserHint(other, { toolName: 'browser_navigate' })).toBe(other)
    })

    test('resolveBookingSlug is the one the booking tools use', () => {
        expect(resolveBookingSlug(BOOKING_URL)).toEqual({ slug: 'karsten-wysk' })
        expect(require('./publicBookingTools').resolveBookingSlug).toBe(resolveBookingSlug)
    })
})
