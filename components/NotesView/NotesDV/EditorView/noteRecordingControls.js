/**
 * Both note recording controls write text and spend Gold, so only project members
 * may see them. The microphone uses the durable recorder for every duration;
 * screen/tab audio keeps its existing capture path and route auto-start.
 */

/**
 * The unified microphone button requires AudioWorklet, IndexedDB and Web Locks.
 * Unsupported browsers must not fall back to the old five-minute dictation path.
 */
export const isNoteMicrophoneVisible = ({ accessGranted, microphoneSupported }) =>
    !!accessGranted && !!microphoneSupported

/** The screen/tab audio button. */
export const isNoteTranscriptionVisible = ({ accessGranted }) => !!accessGranted

/**
 * Auto-start of the meeting transcription (the `autoStartTranscription` route/prop). Hiding the
 * button alone would not be enough: a shared link carrying that flag would still open the
 * microphone/display-capture prompt for a visitor who cannot write the transcript anywhere.
 */
export const canAutoStartNoteTranscription = ({ accessGranted, autoStartTranscription }) =>
    !!accessGranted && !!autoStartTranscription
