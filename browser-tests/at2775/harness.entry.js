import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import TopBarContainer from '../../components/TopBar/TopBarContainer'
import { setLanguage } from '../../i18n/TranslationService'
import store from './store'
setLanguage('de')
window.__actions = []
window.__navigation = []
window.__profileNotifications = 0
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <TopBarContainer />
        <div data-testid="following-content" style={{ padding: 16 }}>
            Aufgaben · Ziele · Notizen · Kontakte · Chats
        </div>
    </Provider>
)
