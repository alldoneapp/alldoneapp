/**
 * AT-3025 — an empty composer offers the microphone where the send button sits.
 *
 * A composer with nothing typed used to show a greyed-out, useless send button. Now the send
 * button's slot holds a blue dictation mic instead, and the small mic the composer already has
 * (in the field or in its toolbar) is hidden, so there is exactly one microphone on screen. As
 * soon as there is text, the send button comes back and the small mic reappears in its usual
 * place, so a draft can still be extended by voice.
 *
 * Both mics are separate `RambleButton` instances that stay MOUNTED for the composer's lifetime;
 * only their `visible` flag changes. A recorder lives inside its button (`useRambleController`),
 * so moving one button between the two places, or unmounting the one not shown, would cancel a
 * take mid-recording — e.g. when the transcript lands and the field stops being empty while the
 * button is still in its 'processing' phase. That is also why a busy mic always wins below: the
 * mic that is recording keeps its place until it is idle again, whatever the text does meanwhile.
 *
 * Pure and dependency-free so every host (CustomTextInput3 for the assistant line, the chat
 * composer and the comment popup; AnnaConversation for the Anna pane) applies the same rule.
 */

// Mirrors RAMBLE_PHASE_IDLE in RambleButton.js; duplicated so this module stays import-free.
const IDLE = 'idle'

const isIdle = phase => !phase || phase === IDLE

/**
 * @param {object} state
 * @param {boolean} state.enabled   dictation is available here AND the host has a send slot to
 *                                  put the mic into. When false nothing changes: the send button
 *                                  shows (greyed out while empty) and the small mic as before.
 * @param {boolean} state.isEmpty   the composer holds no text yet (whitespace counts as empty).
 * @param {string}  state.inlinePhase   phase of the composer's usual small mic.
 * @param {string}  state.sendSlotPhase phase of the mic shown in the send button's place.
 * @returns {{ micInSendSlot: boolean, inlineMicVisible: boolean }}
 *   `micInSendSlot` — show the blue mic and hide the send button.
 *   `inlineMicVisible` — whether the small mic may show (the host's own hover/pin rules still apply).
 */
export function resolveComposerMicSlot({ enabled, isEmpty, inlinePhase, sendSlotPhase }) {
    if (!enabled) return { micInSendSlot: false, inlineMicVisible: true }
    const micInSendSlot = !isIdle(sendSlotPhase) || (!!isEmpty && isIdle(inlinePhase))
    return { micInSendSlot, inlineMicVisible: !micInSendSlot }
}

export const isComposerTextEmpty = text => typeof text !== 'string' || text.trim().length === 0
