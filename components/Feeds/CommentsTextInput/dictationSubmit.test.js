/**
 * How a push-to-talk dictation reaches each input's existing submit action (AT-2405).
 *
 * The product rule is "hold-to-send works everywhere an Enter-submit already exists", and the way
 * that is achieved without touching ~30 host components is by reusing the Enter action they
 * already pass down. The precedence below is the whole contract.
 */
import { resolveDictationSubmit, scheduleDictationSubmit } from './dictationSubmit'

describe('resolveDictationSubmit', () => {
    test('an explicit onDictationSubmit receives the text', () => {
        const onDictationSubmit = jest.fn()

        resolveDictationSubmit({ onDictationSubmit })('draft plus transcript')

        expect(onDictationSubmit).toHaveBeenCalledWith('draft plus transcript')
    })

    test('otherwise it falls back to the generic Enter action used by ~40 hosts', () => {
        const forceTriggerEnterActionForBreakLines = jest.fn()

        resolveDictationSubmit({ forceTriggerEnterActionForBreakLines })('ignored')

        // That callback takes no arguments — it is the same one CustomTextInput3 fires when a
        // newline is inserted, and those hosts read their own state. Passing the text would be a
        // new contract for 40 components.
        expect(forceTriggerEnterActionForBreakLines).toHaveBeenCalledWith()
    })

    test('the explicit hook wins when a host offers both', () => {
        const onDictationSubmit = jest.fn()
        const forceTriggerEnterActionForBreakLines = jest.fn()

        resolveDictationSubmit({ onDictationSubmit, forceTriggerEnterActionForBreakLines })('text')

        expect(onDictationSubmit).toHaveBeenCalled()
        expect(forceTriggerEnterActionForBreakLines).not.toHaveBeenCalled()
    })

    test('an input with no submit of its own returns null and simply inserts', () => {
        // The notes document editor is the case: there is nothing to submit, so holding the mic
        // must dictate and stop there rather than inventing an action.
        expect(resolveDictationSubmit({})).toBeNull()
        expect(resolveDictationSubmit({ onDictationSubmit: 'not a function' })).toBeNull()
    })
})

describe('scheduleDictationSubmit', () => {
    test('the submit is deferred, never run in the caller’s tick', () => {
        const submit = jest.fn()
        let deferred = null

        scheduleDictationSubmit(submit, 'hello', fn => {
            deferred = fn
        })

        // Hosts read the text out of React state that CustomTextInput3 has only just queued via
        // onChangeText. Submitting synchronously would send the pre-dictation draft, and the bug
        // would look like the transcript had been dropped.
        expect(submit).not.toHaveBeenCalled()
        deferred()
        expect(submit).toHaveBeenCalledWith('hello')
    })

    test('nothing is scheduled when the input cannot submit', () => {
        const schedule = jest.fn()

        scheduleDictationSubmit(null, 'hello', schedule)

        expect(schedule).not.toHaveBeenCalled()
    })

    test('it defers through a real macrotask by default', async () => {
        const submit = jest.fn()

        scheduleDictationSubmit(submit, 'hello')
        expect(submit).not.toHaveBeenCalled()

        await new Promise(resolve => setTimeout(resolve, 0))
        expect(submit).toHaveBeenCalledWith('hello')
    })
})
