// Only backend-dependent leaves are stubbed: the translation service (German strings, as in the
// AT-3037 screenshot), the assistant avatar and the author lookup (Firestore). `Comment`,
// `MessageSendStatus`, React Native Web and the colour tokens are shipped code.
import React from 'react'

const GERMAN = {
    'Queued. Sends when the current answer is finished.':
        'In der Warteschlange. Wird gesendet, sobald die aktuelle Antwort fertig ist.',
    'Send now': 'Jetzt senden',
    'Remove queued message': 'Entfernen',
}
export const translate = text => GERMAN[text] || text
export const getDeviceLanguage = () => 'de'
export const getUserLanguageIndexForSendinBlue = () => 0
export const useTranslator = () => translate
export const setLanguage = () => {}
export default function AssistantAvatar() {
    return <span style={{ display: 'block', width: 24, height: 24, borderRadius: 12, background: '#cfd8e3' }} />
}
