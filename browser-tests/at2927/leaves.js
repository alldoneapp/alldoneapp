// Only backend-dependent leaves are stubbed: the avatar (Firestore photo lookup) and the
// translation service (German strings, as in the AT-2927 screenshot). The author row, the
// send status, React Native Web and the Anna CSS are shipped code.
import React from 'react'

const GERMAN = {
    You: 'Du',
    'Queued. Sends when the current answer is finished.':
        'In der Warteschlange. Wird gesendet, sobald die aktuelle Antwort fertig ist.',
    'Send now': 'Jetzt senden',
    'Remove queued message': 'Entfernen',
    assistantLineSending: 'Wird gesendet…',
}
export const translate = text => GERMAN[text] || text
export default function AssistantAvatar() {
    return <span style={{ display: 'block', width: 20, height: 20, borderRadius: 10, background: '#cfd8e3' }} />
}
