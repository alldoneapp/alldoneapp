import { useCallback, useEffect, useReducer, useRef } from 'react'

/**
 * How a push-to-talk dictation submits the input it just wrote into (AT-2405).
 *
 * The mic is rendered next to nearly every text input in the app, and "submit" means something
 * different in each of them — post a comment, create a task, rename a goal, save a note title. The
 * product decision was that hold-to-send should work everywhere an Enter-submit already exists, so
 * the job here is to reach that existing action rather than to reimplement ~30 of them.
 *
 * There are exactly two shapes of Enter-submit in this codebase and this picks between them:
 *
 *  1. `forceTriggerEnterActionForBreakLines` — the generic one, passed by ~40 hosts (EditGoal,
 *     EditChat, CreateTask, EditNote, EditContact, the create-in-mention modals...). CustomTextInput3
 *     already calls it whenever a '\n' is inserted, which IS how Enter submits those inputs. Calling
 *     it directly is therefore not a new contract, just the same one reached without a newline —
 *     and it inherits every guard the host put behind it for free (an open float popup, the
 *     single-flight submit guard, "name must not be empty").
 *
 *  2. `onDictationSubmit` — an explicit opt-in for composers that own their Enter handling with a
 *     document-level keydown listener instead (ChatInput, the MyDay assistant line). Those need the
 *     text passed to them because their submit takes it as an argument.
 *
 * A host that offers neither simply does not auto-submit: the transcript is inserted and that is
 * all. That is the correct default for the notes document editor, which has no submit at all.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A HOOK AND NOT A FUNCTION CALL (the AT-2405 follow-up bug)
 *
 * Those host actions are CLOSURES OVER HOST STATE, and that state is exactly one render behind
 * when a dictation lands. The transcript arrives in a single `updateContents`, which calls
 * `onChangeText` synchronously — but the host's `setState` from it is only QUEUED (React 18
 * auto-batches updates made outside an event handler, and the transcript is delivered from a
 * promise continuation). So at the moment the recorder asks the input to submit, the host's
 * `onKeyEnterPressed` still sees the draft as it was BEFORE the dictation: empty.
 *
 * The first implementation resolved and bound the host callback at that moment and then hopped a
 * macrotask, which fixed nothing — the hop lets React commit, but the already-bound closure keeps
 * pointing at the pre-dictation snapshot. In the add-new-task field that closure reads
 * `hasName === false` and takes the `adding` branch, which DISMISSES the editor:
 *
 *     if (hasName) { adding ? createTask(...) : editTask(...) }
 *     else if (adding) { dismissEditMode() }        // <- what actually ran
 *
 * i.e. holding the mic closed the input and created no task, while the dictated text survived in
 * `tmpInputTextTask` and reappeared the next time the field was opened. The same staleness is
 * silent-but-wrong in every other generic host (an empty-name guard swallows the submit).
 *
 * The fix is to submit from a POST-COMMIT effect and to resolve the host callback THEN:
 *
 *   - arming bumps a reducer, so React must run one more render+commit pass before the effect
 *     fires. That pass is the same batch the host's own `setState` is queued in, so by the time
 *     the effect runs the host has re-rendered and handed this input a callback that can see the
 *     dictated text;
 *   - the callback is read out of a ref written during render, so it is the freshest one that
 *     exists, not the one captured when the recorder finished.
 *
 * That ordering is what makes a dictated task get created by exactly the code path Enter uses.
 */

/**
 * @param {{
 *   onDictationSubmit?: (text: string) => void,
 *   forceTriggerEnterActionForBreakLines?: () => void,
 * }} host
 * @returns {((text: string) => void)|null} null when this input cannot submit itself.
 */
export function resolveDictationSubmit({ onDictationSubmit, forceTriggerEnterActionForBreakLines } = {}) {
    if (typeof onDictationSubmit === 'function') return text => onDictationSubmit(text)
    if (typeof forceTriggerEnterActionForBreakLines === 'function') {
        return () => forceTriggerEnterActionForBreakLines()
    }
    return null
}

/**
 * Returns `armDictationSubmit(getText)`: ask this input to fire its own submit once React has
 * committed the transcript into the host above it.
 *
 * `getText` is a getter rather than a string because it is read at fire time too — the text a host
 * that takes an argument (`onDictationSubmit`) must receive is draft + transcript, and
 * CustomTextInput3 keeps that in a ref that is written synchronously during insertion.
 */
export default function useDictationSubmit({ onDictationSubmit, forceTriggerEnterActionForBreakLines }) {
    // Written during render: whatever the last render handed this input is the closure that can
    // see the dictated text. Reading the props captured when the recording finished is precisely
    // the bug documented above.
    const hostRef = useRef(null)
    hostRef.current = { onDictationSubmit, forceTriggerEnterActionForBreakLines }

    const pendingRef = useRef(null)
    const [armedTick, arm] = useReducer(tick => tick + 1, 0)

    useEffect(() => {
        const getText = pendingRef.current
        if (!getText) return
        // Cleared before submitting: a host action that re-renders this input (every one of them
        // does) must not be able to re-enter this effect and submit twice.
        pendingRef.current = null
        const submit = resolveDictationSubmit(hostRef.current)
        if (!submit) return
        submit(getText())
    }, [armedTick])

    return useCallback(getText => {
        pendingRef.current = typeof getText === 'function' ? getText : () => getText
        arm()
    }, [])
}
