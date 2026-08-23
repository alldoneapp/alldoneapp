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
 */

/**
 * @param {{
 *   onDictationSubmit?: (text: string) => void,
 *   forceTriggerEnterActionForBreakLines?: () => void,
 * }} host
 * @returns {((text: string) => void)|null} null when this input cannot submit itself.
 */
export function resolveDictationSubmit({ onDictationSubmit, forceTriggerEnterActionForBreakLines }) {
    if (typeof onDictationSubmit === 'function') return text => onDictationSubmit(text)
    if (typeof forceTriggerEnterActionForBreakLines === 'function') {
        return () => forceTriggerEnterActionForBreakLines()
    }
    return null
}

/**
 * Hosts read the text they are about to submit out of their own React state, which
 * CustomTextInput3 feeds through `onChangeText` while the transcript is being inserted. Those
 * setState calls are queued, not applied, so submitting in the same tick would send the draft as it
 * was BEFORE the dictation — the bug would be silent and would look like the transcript was
 * dropped. A macrotask hop lets React 18 flush the batch first. ChatInput's own
 * `triggerChatSubmit` path already does this (with a 100ms sleep) for the same reason.
 */
export function scheduleDictationSubmit(submit, text, schedule = fn => setTimeout(fn, 0)) {
    if (!submit) return
    schedule(() => submit(text))
}
