/**
 * Visibility rules for the two recording controls in the note editor toolbar (AT-2384).
 *
 * Both of them WRITE into the note: "Dictate" transcribes a one-shot mic recording and inserts it
 * at the caret, and "Transcribe" live-appends a meeting transcription (and its screenshots). They
 * therefore only make sense for someone who may actually edit the note.
 *
 * The public / not-logged-in view of a note renders the same toolbar with `accessGranted === false`
 * and `readOnly === true`. Every other writing control there (headings, formatting, Date, Task,
 * link, image, lists, the more-popup) is already hidden behind `accessGranted`; the two recording
 * buttons were not, so an anonymous visitor saw a microphone and a record button that were inert
 * (`pointerEvents: 'none'`) and — worse — advertised a feature that needs an account and spends
 * Gold. They now follow the same rule as the rest of the bar.
 *
 * `accessGranted` (project member, `SharedHelper.accessGranted`) is deliberately the gate rather
 * than "is not anonymous": a logged-in non-member viewing a public note is in exactly the same
 * read-only situation as an anonymous visitor, and the neighbouring buttons already treat the two
 * the same way. Nothing about the layout changes for a member.
 */

/**
 * The microphone ("Dictate") button. `dictationSupported` stays a separate input so the caller
 * keeps owning the browser-capability question (`isDictationSupported()`); this module only adds
 * the access rule on top of it.
 */
export const isNoteDictationVisible = ({ accessGranted, dictationSupported }) => !!accessGranted && !!dictationSupported

/** The meeting recording ("Transcribe") button. */
export const isNoteTranscriptionVisible = ({ accessGranted }) => !!accessGranted

/**
 * Auto-start of the meeting transcription (the `autoStartTranscription` route/prop). Hiding the
 * button alone would not be enough: a shared link carrying that flag would still open the
 * microphone/display-capture prompt for a visitor who cannot write the transcript anywhere.
 */
export const canAutoStartNoteTranscription = ({ accessGranted, autoStartTranscription }) =>
    !!accessGranted && !!autoStartTranscription
