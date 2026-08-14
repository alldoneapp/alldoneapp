import { useRef } from 'react'

/**
 * Guard against duplicated submissions of the same intent.
 *
 * Creation popups in this app wire the same submit handler to several
 * independent Enter triggers at once (a global `document` keydown listener per
 * button area, plus Quill's newline delta callback), and closing the popup is
 * asynchronous. Pressing Return twice quickly, holding Return down, or a single
 * Return that reaches more than one listener therefore used to run the whole
 * creation more than once, and every run mints a new object id.
 *
 * `createSingleFlightSubmit` wraps a submit function so that only the first
 * call runs while a submission is in flight. Later calls are ignored and get
 * the pending result back instead of starting a second write.
 *
 * @param {Function} submit the function performing the submission
 * @param {Object} [options]
 * @param {boolean} [options.releaseOnSuccess=false] when false (the default)
 *   the wrapper is one-shot: after a successful submission it stays locked, so
 *   a popup that has already created its object can never create a second one.
 *   Set it to true for editors that intentionally stay open to create several
 *   objects in a row (for example the inline "add task" repeat mode); those
 *   still get full protection while a submission is in flight.
 * @returns {Function} the guarded submit function, with `isInFlight()` and
 *   `reset()` helpers attached.
 */
/**
 * Options for editors that stay open after a successful submission and are
 * meant to create several objects in a row. They are still protected while a
 * submission is in flight.
 */
export const RELEASE_AFTER_SUBMISSION = { releaseOnSuccess: true }

export const createSingleFlightSubmit = (submit, options = {}) => {
    const { releaseOnSuccess = false } = options

    let inFlight = false
    let pendingResult

    const reset = () => {
        inFlight = false
        pendingResult = undefined
    }

    const run = (...args) => {
        if (inFlight) return pendingResult

        inFlight = true

        let result
        try {
            result = submit(...args)
        } catch (error) {
            // A submission that never started must not lock the popup.
            reset()
            throw error
        }

        if (result && typeof result.then === 'function') {
            pendingResult = result
            // Observe the original promise instead of returning a derived one,
            // so callers keep the exact rejection behaviour they had before.
            result.then(
                () => {
                    if (releaseOnSuccess) reset()
                },
                () => {
                    // Let the user retry when the write actually failed.
                    reset()
                }
            )
            return result
        }

        if (releaseOnSuccess) reset()
        else pendingResult = result

        return result
    }

    run.isInFlight = () => inFlight
    run.reset = reset

    return run
}

/**
 * React binding for {@link createSingleFlightSubmit}. The returned function
 * keeps a stable identity for the lifetime of the component while always
 * calling the latest `submit` closure, so it can guard handlers that close over
 * changing state (such as the task being typed).
 */
export default function useSingleFlightSubmit(submit, options) {
    const submitRef = useRef(submit)
    submitRef.current = submit

    const runnerRef = useRef()
    if (!runnerRef.current) {
        runnerRef.current = createSingleFlightSubmit((...args) => submitRef.current(...args), options)
    }

    return runnerRef.current
}
