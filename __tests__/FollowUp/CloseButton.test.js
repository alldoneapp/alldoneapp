import React from 'react'
import CloseButton from '../../components/FollowUp/CloseButton'
import ModalHeader from '../../components/UIComponents/FloatModals/ModalHeader'
import renderer from 'react-test-renderer'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

/**
 * Collect every CSS declaration react-native-web injected for the classes on
 * `element`. RNW compiles styles to atomic classes, so the only way to assert
 * on a resolved style is to read the generated rules back out of the sheet.
 */
const resolvedStyleFor = element => {
    const classes = new Set(element.className.split(/\s+/).filter(Boolean))
    let css = ''
    for (const sheet of document.styleSheets) {
        let rules
        try {
            rules = sheet.cssRules
        } catch (e) {
            continue
        }
        for (const rule of rules) {
            if (rule.selectorText && classes.has(rule.selectorText.replace(/^\./, ''))) css += rule.cssText
        }
    }
    // Normalise CSSOM spacing so assertions do not depend on serialisation.
    return css.replace(/\s+/g, '')
}

/**
 * RNW emits one atomic class per declaration, so an element carries both the
 * base View rule (`z-index: 0`) and any override. Rules are collected in sheet
 * order, so the last declaration is the effective one.
 */
const effectiveZIndex = element => {
    const matches = [...resolvedStyleFor(element).matchAll(/z-index:(-?\d+)/g)]
    return matches.length ? Number(matches[matches.length - 1][1]) : null
}

const renderToDom = ui => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(ui))
    return {
        container,
        cleanup: () => {
            act(() => root.unmount())
            container.remove()
        },
    }
}

describe('CloseButton component', () => {
    beforeAll(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
    })

    describe('CloseButton snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<CloseButton close={() => {}} />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    describe('stacking order (AT-2190)', () => {
        // react-native-web gives every View `z-index: 0` and every Text
        // `position: relative`. The close button and the title/description
        // Texts next to it are therefore all *positioned* boxes inside the same
        // stacking context, which CSS paints in tree order. ModalHeader (and
        // most modals that use CloseButton directly) renders the button BEFORE
        // the title, so without an explicit lift the full-width title box is
        // painted on top of the button and swallows the click over most of the
        // X -- the popup then simply does not close.
        it('lifts the close button above its later siblings', () => {
            const { container, cleanup } = renderToDom(<CloseButton close={() => {}} />)
            const style = resolvedStyleFor(container.firstChild)

            expect(style).toContain('position:absolute')
            expect(effectiveZIndex(container.firstChild)).toBeGreaterThan(0)

            cleanup()
        })

        it('keeps the close button paintable above the ModalHeader title', () => {
            const { container, cleanup } = renderToDom(
                <ModalHeader closeModal={() => {}} title="Add task" description="Some description" />
            )

            const header = container.firstChild
            const closeContainer = header.children[0]
            // Guard the precondition the z-index exists for: the button really
            // is rendered before the title, so tree order alone would lose.
            expect(header.children.length).toBeGreaterThan(1)
            expect(resolvedStyleFor(closeContainer)).toContain('position:absolute')

            // The title/description Texts that follow are positioned boxes with
            // the default z-index, so the button must outrank them.
            const title = header.children[1]
            expect(effectiveZIndex(closeContainer)).toBeGreaterThan(effectiveZIndex(title) || 0)

            cleanup()
        })
    })

    describe('close behaviour', () => {
        it('calls close when the X is pressed', async () => {
            const close = jest.fn()
            const { container, cleanup } = renderToDom(<CloseButton close={close} />)

            const touchable = container.querySelector('[tabindex="0"]')
            act(() => {
                for (const type of ['mousedown', 'mouseup', 'click']) {
                    touchable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
                }
            })

            // onPress defers close() by a tick so the press cannot be read as an
            // outside click by the popup that owns the button.
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(close).toHaveBeenCalledTimes(1)
            cleanup()
        })

        it('calls close on Escape unless escape handling is disabled', () => {
            const close = jest.fn()
            const first = renderToDom(<CloseButton close={close} />)
            act(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            })
            expect(close).toHaveBeenCalledTimes(1)
            first.cleanup()

            const disabled = jest.fn()
            const second = renderToDom(<CloseButton close={disabled} disabledEscape />)
            act(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            })
            expect(disabled).not.toHaveBeenCalled()
            second.cleanup()
        })
    })
})
