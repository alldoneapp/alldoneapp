/**
 * @jest-environment jsdom
 */
import { swallowNextClick } from './swallowNextClick'

describe('swallowNextClick (AT-2823)', () => {
    let listener

    beforeEach(() => {
        jest.useFakeTimers()
        listener = jest.fn()
        window.addEventListener('click', listener)
    })

    afterEach(() => {
        window.removeEventListener('click', listener)
        jest.useRealTimers()
    })

    const click = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    test('eats exactly one click, before bubble-phase window listeners see it', () => {
        swallowNextClick(700)

        click()
        expect(listener).not.toHaveBeenCalled()

        click()
        expect(listener).toHaveBeenCalledTimes(1)
    })

    test('expires, so a click that never came cannot eat a later genuine one', () => {
        swallowNextClick(700)
        jest.advanceTimersByTime(701)

        click()
        expect(listener).toHaveBeenCalledTimes(1)
    })

    test('can be removed early', () => {
        const remove = swallowNextClick(700)
        remove()

        click()
        expect(listener).toHaveBeenCalledTimes(1)
    })
})
