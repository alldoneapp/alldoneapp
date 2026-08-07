import { getFeedsQueryLimit, MAX_NUMBER_OF_FEEDS_TO_REVIEW, MAX_NUMBER_OF_FEEDS_TO_SHOW } from './feedQueryLimits'

// The amounts the Updates page can display, from components/Feeds/Utils/FeedsHelper.js. Duplicated
// here on purpose: if one of those constants moves, this suite should be revisited rather than
// silently follow along.
const ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY = 5
const STANDARD_FEEDS_AMOUNT_TO_DISPLAY = 20
const MAX_FEEDS_AMOUNT_TO_DISPLAY = 99

describe('getFeedsQueryLimit', () => {
    it('caps the query at the number of feeds the list can display', () => {
        // The regression this guards: both of these used to be a flat 200 documents per project per
        // tab, for a page that renders 5 rows per project.
        expect(getFeedsQueryLimit(ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY, false)).toBe(5)
        expect(getFeedsQueryLimit(STANDARD_FEEDS_AMOUNT_TO_DISPLAY, false)).toBe(20)
    })

    it('grows to the show-more ceiling when the list is expanded', () => {
        expect(getFeedsQueryLimit(MAX_FEEDS_AMOUNT_TO_DISPLAY, false)).toBe(MAX_NUMBER_OF_FEEDS_TO_SHOW)
    })

    it('never exceeds the amount the snapshot handler keeps anyway', () => {
        // watchNewFeedsTabRedux truncates every snapshot at MAX_NUMBER_OF_FEEDS_TO_SHOW, so asking
        // for more can only ever cost bandwidth.
        expect(getFeedsQueryLimit(500, false)).toBe(MAX_NUMBER_OF_FEEDS_TO_SHOW)
        expect(getFeedsQueryLimit(MAX_NUMBER_OF_FEEDS_TO_REVIEW, false)).toBe(MAX_NUMBER_OF_FEEDS_TO_SHOW)
    })

    it('keeps the legacy head-room while another user is being viewed', () => {
        // Then the snapshot is narrowed again in JS, so an unknown number of the fetched documents
        // never reach the list and the cap can no longer be derived from what is rendered.
        expect(getFeedsQueryLimit(ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY, true)).toBe(MAX_NUMBER_OF_FEEDS_TO_REVIEW)
        expect(getFeedsQueryLimit(MAX_FEEDS_AMOUNT_TO_DISPLAY, true)).toBe(MAX_NUMBER_OF_FEEDS_TO_REVIEW)
    })

    it('falls back to the show-more ceiling when no amount is provided', () => {
        // Any caller that has not been taught about the cap still gets a working - and already
        // halved - listener rather than an empty one.
        expect(getFeedsQueryLimit(undefined, false)).toBe(MAX_NUMBER_OF_FEEDS_TO_SHOW)
        expect(getFeedsQueryLimit(null, false)).toBe(MAX_NUMBER_OF_FEEDS_TO_SHOW)
        expect(getFeedsQueryLimit(NaN, false)).toBe(MAX_NUMBER_OF_FEEDS_TO_SHOW)
    })

    it('never produces a limit Firestore would reject', () => {
        expect(getFeedsQueryLimit(0, false)).toBe(1)
        expect(getFeedsQueryLimit(-10, false)).toBe(1)
        expect(getFeedsQueryLimit(2.4, false)).toBe(3)
    })

    it('returns the same first page as the old fixed limit for every displayable amount', () => {
        // The list reads `feeds.slice(0, visible)` off the snapshot, so capping the query is only
        // safe if the first `visible` documents are identical. They are, because the cap is never
        // below `visible` and the order is unchanged.
        const feeds = Array.from({ length: MAX_NUMBER_OF_FEEDS_TO_REVIEW }, (_, index) => `feed-${index}`)

        for (const visible of [1, ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY, STANDARD_FEEDS_AMOUNT_TO_DISPLAY, 99]) {
            const capped = feeds.slice(0, getFeedsQueryLimit(visible, false))
            const legacy = feeds.slice(0, MAX_NUMBER_OF_FEEDS_TO_REVIEW)

            expect(capped.slice(0, visible)).toEqual(legacy.slice(0, visible))
            expect(capped.length).toBeGreaterThanOrEqual(Math.min(visible, MAX_NUMBER_OF_FEEDS_TO_SHOW))
        }
    })
})
