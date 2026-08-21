/** @jest-environment jsdom */

// AT-2339 ratchets. The point of the fix was to move popup geometry onto ONE
// authority (utils/modalSafeArea.js) instead of ~95 hand-rolled window-height
// subtractions, and the way that decays is a new popup copying an old
// neighbour. These checks are static and cheap so a copy-paste regression
// fails the build rather than shipping to an iPhone.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const collectJsFiles = dir => {
    const out = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue
            out.push(...collectJsFiles(full))
        } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            out.push(full)
        }
    }
    return out
}

const read = file => fs.readFileSync(file, 'utf8')

describe('AT-2339: popup height caps go through the safe-area authority', () => {
    // The legacy idiom. `MODAL_MAX_HEIGHT_GAP` itself still exists as a token
    // (utils/HelperFunctions.js exports it, components/styles/modals.js
    // documents it) — what must not come back is SUBTRACTING it from a raw
    // window height, which is what ignored the notch.
    it('no component subtracts the raw gap from a window height any more', () => {
        const offenders = collectJsFiles(path.join(ROOT, 'components'))
            .filter(file => / - MODAL_MAX_HEIGHT_GAP/.test(read(file)))
            .map(file => path.relative(ROOT, file))

        expect(offenders).toEqual([])
    })

    it('no component caps a modal against a raw Dimensions/window height', () => {
        const rawCap = /maxHeight:\s*(?:screenDimensions|dimensions|dim)\.height\s*-\s*\d+/
        const offenders = collectJsFiles(path.join(ROOT, 'components'))
            .filter(file => rawCap.test(read(file)))
            .map(file => path.relative(ROOT, file))

        expect(offenders).toEqual([])
    })

    // The spellings the first sweep's codemod could not see. Each one is a
    // window-height cap wearing a different name, and each was a real miss
    // found by auditing rather than by grepping for the known idiom.
    it('no component re-derives a modal cap from a local vertical-margin constant', () => {
        const localMargin = /maxHeight\s*=\s*Math\.max\(\s*windowHeight\s*-\s*[A-Z_]+\s*\*\s*2/
        const offenders = collectJsFiles(path.join(ROOT, 'components'))
            .filter(file => localMargin.test(read(file)))
            .map(file => path.relative(ROOT, file))

        expect(offenders).toEqual([])
    })

    it('no popup caps itself with a raw vh unit', () => {
        // `vh` is a fraction of the RAW viewport, so it cannot see the insets.
        // getSafeAreaViewportHeightCap is the drop-in.
        const vhCap = /maxHeight:\s*'\d+vh'/
        const offenders = collectJsFiles(path.join(ROOT, 'components'))
            .filter(file => vhCap.test(read(file)))
            .map(file => path.relative(ROOT, file))

        expect(offenders).toEqual([])
    })

    it('no popover is pinned at hard-coded literal coordinates', () => {
        // `contentLocation={() => ({ top: 60, left: 16 })}` together with
        // `disableReposition` is the one combination nothing else can rescue:
        // the library never nudges it into the safe rectangle.
        const literalPin = /return\s*\{\s*top:\s*\d+\s*,\s*left:\s*\d+\s*\}/
        const offenders = collectJsFiles(path.join(ROOT, 'components'))
            .filter(file => literalPin.test(read(file)))
            .map(file => path.relative(ROOT, file))

        expect(offenders).toEqual([])
    })
})

describe('AT-2339: the fixed-overlay dialog family pads for the safe area', () => {
    // These render their own full-viewport `position: fixed` overlay and centre
    // a card inside it, so they are invisible to both the popover library's
    // safe-area nudge and to useModalSizing. Each must pull the padding from
    // the shared hook. The "new day" popup (EndDayStatisticsModal) is the one
    // that was reported.
    const OVERLAY_FAMILY = [
        'components/UIComponents/FloatModals/EndDayStatisticsModal.js',
        // Same card, same overlay, on demand from Settings → Happiness (AT-2392).
        'components/ProjectHappiness/HappinessRatingModal.js',
        'components/UIComponents/FloatModals/LevelUpModal/LevelUpModal.js',
        'components/UIComponents/FloatModals/ChangeContactInfoModalContainerForNewGuideUsers.js',
        'components/UIComponents/FloatModals/IframeModal/IframeModal.js',
        'components/UIComponents/FloatModals/PreConfigTaskGeneratorModal/GlobalPreConfigTaskModal.js',
        'components/Premium/LimitModal/LimitModal.js',
        'components/Premium/LimitModalPremium/LimitModalPremium.js',
        'components/Premium/LimitedFeatureModal.js',
        'components/Premium/FreePlanWarning.js',
        'components/MediaBar/ScreenRecording/NotAvailableScreenRecording.js',
        // Found by audit after the first sweep: same shape, different spelling,
        // so neither the codemod nor the regexes above could see them.
        'components/Onboarding/WhatsAppOnboarding.js',
        'components/MeetingBooking/MeetingBookingPage.js',
    ]

    // The top-pinned family, which shares utils/fixedModalPosition.js.
    const TOP_PINNED_FAMILY = [
        'components/ChatsView/ChatDV/EditorView/BotOption/BotWarningModal.js',
        'components/ProjectDetailedView/ProjectProperties/CopyProject/EndCopyProjectNotification.js',
        'components/Suggeted/TaskSuggestedComment.js',
        'components/UIComponents/AccessDeniedPopup.js',
        'components/UIComponents/ConfirmPopup.js',
        'components/UIComponents/ProjectDontExistInInvitationModal.js',
        'components/UIComponents/FloatModals/NoteMaxLengthModal.js',
        'components/UIComponents/ProjectInvitation/ProjectInvitationPopup.js',
    ]

    it.each(OVERLAY_FAMILY)('%s applies the overlay safe-area padding', file => {
        const source = read(path.join(ROOT, file))

        expect(source).toMatch(/useSafeAreaOverlayPadding/)
        // Applied to the overlay's style array, not merely imported.
        expect(source).toMatch(/safeAreaOverlayPadding\]/)
    })

    it.each(TOP_PINNED_FAMILY)('%s applies the top-pinned safe-area padding', file => {
        const source = read(path.join(ROOT, file))

        expect(source).toMatch(/useFixedModalOverlayPadding/)
        expect(source).toMatch(/safeAreaOverlayPadding\]/)
    })

    // The padding has to sit on the OVERLAY, and it has to come last in the
    // style array, or the static paddingTop/paddingBottom it is meant to
    // override wins instead.
    it.each([...OVERLAY_FAMILY, ...TOP_PINNED_FAMILY])('%s puts the padding last in the style array', file => {
        const source = read(path.join(ROOT, file))
        const usage = source.match(/style=\{\[[^\]]*safeAreaOverlayPadding[^\]]*\]\}/)

        expect(usage).not.toBeNull()
        expect(usage[0]).toMatch(/safeAreaOverlayPadding\s*\]\}$/)
    })
})

describe('AT-2339: useSafeAreaOverlayPadding', () => {
    const renderHookValue = (Hook, args) => {
        const React = require('react')
        const renderer = require('react-test-renderer')
        let value
        const Probe = () => {
            value = Hook(args)
            return null
        }
        let tree
        renderer.act(() => {
            tree = renderer.create(React.createElement(Probe))
        })
        return { value: () => value, tree }
    }

    const mockInsets = insets => {
        jest.spyOn(window, 'getComputedStyle').mockImplementation(element => {
            if (element.hasAttribute && element.hasAttribute('data-safe-area-inset-probe')) {
                return {
                    paddingTop: `${insets.top}px`,
                    paddingRight: `${insets.right}px`,
                    paddingBottom: `${insets.bottom}px`,
                    paddingLeft: `${insets.left}px`,
                }
            }
            return { paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' }
        })
        // getSafeAreaInsets caches by viewport size; move it so we re-measure.
        window.innerWidth += 1
    }

    afterEach(() => jest.restoreAllMocks())

    it('gives a gapless overlay the measured insets on all four edges', () => {
        mockInsets({ top: 47, right: 0, bottom: 34, left: 0 })
        const useSafeAreaOverlayPadding = require('../hooks/useSafeAreaOverlayPadding').default

        expect(renderHookValue(useSafeAreaOverlayPadding).value()).toEqual({
            paddingTop: 47,
            paddingRight: 0,
            paddingBottom: 34,
            paddingLeft: 0,
        })
    })

    it('leaves the top-pinned family where it already was, but covers the cutout', () => {
        // The 80px top offset already clears a 47px island, so the dialog must
        // not move; the landscape cutout on the left is what it gains.
        mockInsets({ top: 47, right: 0, bottom: 34, left: 59 })
        const { useFixedModalOverlayPadding } = require('../hooks/useSafeAreaOverlayPadding')

        expect(renderHookValue(useFixedModalOverlayPadding).value()).toEqual({
            paddingTop: 80,
            paddingRight: 0,
            paddingBottom: 34,
            paddingLeft: 59,
        })
    })

    it('is a no-op on a browser without safe-area insets', () => {
        mockInsets({ top: 0, right: 0, bottom: 0, left: 0 })
        const useSafeAreaOverlayPadding = require('../hooks/useSafeAreaOverlayPadding').default

        expect(renderHookValue(useSafeAreaOverlayPadding).value()).toEqual({
            paddingTop: 0,
            paddingRight: 0,
            paddingBottom: 0,
            paddingLeft: 0,
        })
    })
})
