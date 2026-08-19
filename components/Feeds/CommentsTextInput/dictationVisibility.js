/**
 * Visibility rules for the dictation (rambler) mic overlay rendered by CustomTextInput3.
 *
 * By default the mic is a quiet affordance: it appears while the input is hovered or focused
 * (`activityVisible`, driven by the focusin/mouseenter listeners on the input frame) so that a
 * task row, a comment field or a note title is not permanently decorated with an icon.
 *
 * Composer-style inputs — the assistant line and the main chat input — are different: dictating
 * IS one of the two primary ways to use them, and on touch devices the activity rule means the
 * mic only shows up AFTER the user has already tapped into the field and the keyboard has taken
 * over the screen, i.e. exactly when it is least useful (AT-2355). Those inputs opt in with
 * `alwaysShowDictation`, which pins the mic on.
 *
 * Nothing about layout changes either way: the horizontal strip the mic occupies is reserved by
 * the `.ql-editorWithDictation` padding for as long as dictation is enabled at all, visible or
 * not, so pinning the mic on cannot reflow the text.
 */

/**
 * Whether the host still needs the hover/focus listeners. With `alwaysShowDictation` the answer is
 * no — the mic never hides, so tracking activity would only produce redundant state updates.
 */
export const shouldTrackDictationActivity = ({ dictationEnabled, alwaysShowDictation }) =>
    !!dictationEnabled && !alwaysShowDictation

/**
 * Whether the mic button renders. `alwaysShowDictation` wins over the activity state; the button
 * itself keeps its own override for an in-flight recording (see RambleButton), so a mic that is
 * pinned on can never be less visible than one that is not.
 */
export const isDictationButtonVisible = ({ alwaysShowDictation, activityVisible }) =>
    !!alwaysShowDictation || !!activityVisible
