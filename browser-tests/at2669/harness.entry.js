import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

import ChatsEmailConnectionStatus from '../../components/ChatsView/ChatsEmailConnectionStatus'
import { setLanguage } from '../../i18n/TranslationService'

setLanguage('de')
const connectionId = 'email_google_aaaaaaaa'
window.__configs = { [`gmailLabeling_${connectionId}`]: { enabled: true, syncIntervalMinutes: 60 } }
const loggedUser = {
    uid: 'fixture-user',
    premium: { status: 'premium' },
    emailConnections: { [connectionId]: { provider: 'google', emailAddress: 'fixture@example.com' } },
}
const store = createStore(() => ({ loggedUser }))
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <div style={{ padding: 16, maxWidth: 1000, margin: '0 auto', background: 'white' }}>
            <ChatsEmailConnectionStatus />
        </div>
    </Provider>
)
