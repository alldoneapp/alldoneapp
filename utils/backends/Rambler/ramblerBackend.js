import { runHttpsCallableFunction } from '../firestore'

// Long audio + LLM cleanup can exceed the SDK's ~70s default; the function itself allows 300s.
const PROCESS_RAMBLE_TIMEOUT_MS = 180000

export function processRamble({ projectId, audio, mimeType, targetKind, currentText, durationSeconds, language }) {
    return runHttpsCallableFunction(
        'processRambleSecondGen',
        { projectId, audio, mimeType, targetKind, currentText, durationSeconds, language },
        { timeout: PROCESS_RAMBLE_TIMEOUT_MS }
    )
}

export { PROCESS_RAMBLE_TIMEOUT_MS }
