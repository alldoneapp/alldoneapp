import { resetDetailedViewScroll, scrollDocumentToTop, scrollRefToTop } from './scrollUtils'

describe('scrollUtils', () => {
    beforeEach(() => {
        window.scrollTo = jest.fn()
        document.documentElement.scrollTop = 200
        document.documentElement.scrollLeft = 20
        document.body.scrollTop = 300
        document.body.scrollLeft = 30
    })

    it('resets every browser document scroll holder', () => {
        scrollDocumentToTop()

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
        expect(document.documentElement.scrollTop).toBe(0)
        expect(document.documentElement.scrollLeft).toBe(0)
        expect(document.body.scrollTop).toBe(0)
        expect(document.body.scrollLeft).toBe(0)
    })

    it('resets a CustomScrollView through its imperative ref', () => {
        const scrollTo = jest.fn()

        scrollRefToTop({ current: { scrollTo } })

        expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false })
    })

    it('resets both document and detail-view scrolling together', () => {
        const scrollTo = jest.fn()

        resetDetailedViewScroll({ current: { scrollTo } })

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
        expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false })
    })
})
