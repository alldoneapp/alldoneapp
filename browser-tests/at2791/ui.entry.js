import React from 'react'
import { createRoot } from 'react-dom/client'
import NoteRecordingButtons from '../../components/NotesView/NotesDV/EditorView/NoteRecordingButtons'
import MeetingMicrophoneStatus from '../../components/NotesView/NotesDV/EditorView/MeetingMicrophoneStatus'
import { setLanguage } from '../../i18n/TranslationService'

setLanguage('de')
window.stopClicks = 0
window.retryClicks = 0
window.microphoneClicks = 0
window.screenClicks = 0
const base = {
    phase: 'idle',
    pending: 0,
    error: '',
    captureError: '',
    device: 'Testmikrofon',
    signal: true,
    stop: () => window.stopClicks++,
    retry: () => window.retryClicks++,
}
const cases = [
    ['Aufnahme läuft', { phase: 'recording' }],
    ['Netz unterbrochen, Aufnahme läuft weiter', { phase: 'recording', pending: 8, error: 'offline' }],
    ['Aufnahme beendet, Notiz wird noch gespeichert', { pending: 2, error: 'note-pending' }],
    ['Schreibfehler: Aufnahme gestoppt', { pending: 2, error: 'storage' }],
]
const container = document.createElement('main')
const style = document.createElement('style')
style.textContent =
    '@font-face { font-family: alldone; src: url(/icons.ttf); } @font-face { font-family: Roboto-Regular; src: url(/review-font.ttf); } @font-face { font-family: Review; src: url(/review-font.ttf); } body { font-family: Review; } button { font-family: inherit; padding: 3px 10px; }'
document.head.appendChild(style)
document.body.style.cssText = 'margin: 24px; background: white; color: #222;'
document.body.appendChild(container)
createRoot(container).render(
    <>
        <h2>Mikrofonaufnahme</h2>
        <p>Ein Mikrofon-Button für kurze und lange Aufnahmen · Bildschirm-/Tab-Audio als zusätzliche Option</p>
        <div style={{ marginBottom: 24 }}>
            <NoteRecordingButtons
                microphoneVisible
                screenVisible
                recorder={{ ...base, elapsed: 0 }}
                onMicrophone={() => window.microphoneClicks++}
                onScreen={() => window.screenClicks++}
            />
        </div>
        <p>Isolierte Toolbar- und Statuskomponenten mit Beispieldaten · kein Hardware- oder vollständiger App-Test</p>
        {cases.map(([label, state]) => (
            <section key={label} style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>{label}</h3>
                <MeetingMicrophoneStatus recorder={{ ...base, ...state }} elapsedLabel="12:34" />
            </section>
        ))}
    </>
)
