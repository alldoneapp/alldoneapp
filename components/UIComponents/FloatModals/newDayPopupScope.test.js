import { getNewDayFullWindowLayout, isNewDayFullWindowLayout } from './newDayPopupScope'
import { POPOVER_DESKTOP_WIDTH, POPOVER_MOBILE_WIDTH, POPOVER_TABLET_WIDTH } from '../../styles/global'

describe('isNewDayFullWindowLayout (AT-3083)', () => {
    it.each([
        ['alldone', false],
        ['chat', true],
        ['split', true],
        [undefined, false],
    ])('layout %s -> whole window %s', (layout, expected) => {
        expect(isNewDayFullWindowLayout(layout)).toBe(expected)
    })
})

describe('getNewDayFullWindowLayout (AT-3083)', () => {
    it('uses the desktop card on a wide window, whatever the Alldone pane measures', () => {
        const layout = getNewDayFullWindowLayout({ windowWidth: 1440 })
        expect(layout.compact).toBe(false)
        expect(layout.cardStyle).toEqual({
            minWidth: POPOVER_DESKTOP_WIDTH,
            maxWidth: POPOVER_DESKTOP_WIDTH,
            width: POPOVER_DESKTOP_WIDTH,
        })
        expect(layout.overlayPadding).toEqual({ paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 })
    })

    it('uses the tablet card on a middle-sized window', () => {
        const layout = getNewDayFullWindowLayout({ windowWidth: 1000 })
        expect(layout.compact).toBe(true)
        expect(layout.cardStyle.width).toBe(POPOVER_TABLET_WIDTH)
    })

    it('fills a phone window minus the gutter and clears the safe areas of the window', () => {
        const insets = { top: 47, right: 0, bottom: 34, left: 0 }
        const layout = getNewDayFullWindowLayout({ windowWidth: 390, insets })
        expect(layout.compact).toBe(true)
        expect(layout.cardStyle.width).toBe(390 - 32)
        expect(layout.overlayPadding).toEqual({ paddingTop: 47, paddingRight: 0, paddingBottom: 34, paddingLeft: 0 })
    })

    it('falls back to the mobile card while the window is not measurable yet', () => {
        expect(getNewDayFullWindowLayout({ windowWidth: 0 }).cardStyle.width).toBe(POPOVER_MOBILE_WIDTH)
        expect(getNewDayFullWindowLayout({}).cardStyle.width).toBe(POPOVER_MOBILE_WIDTH)
    })
})
