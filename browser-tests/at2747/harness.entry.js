import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import LoadingData from '../../components/UIComponents/LoadingData'
import { reduceLoadingData } from '../../redux/loadingData'
import { beginLoadingOperation } from '../../utils/redux/loadingOperation'

const initialState = {
    loggedUser: { isAnonymous: false, sidebarExpanded: true },
    smallScreenNavigation: false,
    isLoadingNoteData: false,
    isLoadingData: 0,
    showLoadingDataSpinner: false,
}
const store = createStore((state = initialState, action) =>
    action.type === 'fixture' ? { ...state, ...action.state } : reduceLoadingData(state, action)
)
let finishSync
window.noteLoadingFixture = {
    update: state => store.dispatch({ type: 'fixture', state }),
    sync: () => {
        finishSync = beginLoadingOperation('note_content_sync', { dispatch: store.dispatch })
    },
    finish: () => finishSync?.(),
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <LoadingData />
        <main style={{ padding: 32 }}>
            <h1>Note loading indicator</h1>
            <p>Layout fixture using the real shared spinner. Note editor behavior is covered by Jest.</p>
            <button id="editor-action">Editor action</button>
        </main>
    </Provider>
)
