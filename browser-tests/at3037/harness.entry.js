import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import CommentsList from '../../components/UIComponents/FloatModals/RichCommentModal/CommentsList'
import { colors } from '../../components/styles/global'
import { setColorModePreference } from '../../Themes/colorMode'
import font from '../../assets/fonts/Roboto-Regular.ttf'
import medium from '../../assets/fonts/Roboto-Medium.ttf'
import icons from '../../assets/fonts/alldone.ttf'

const params = new URLSearchParams(window.location.search)
setColorModePreference(params.get('mode') === 'dark' ? 'dark' : 'light')

const style = document.createElement('style')
style.textContent = `@font-face{font-family:Roboto-Regular;src:url('${font}')} @font-face{font-family:Roboto-Medium;src:url('${medium}')} @font-face{font-family:alldone;src:url('${icons}')} html,body,#root{margin:0;font-family:Roboto-Regular,Arial}`
document.head.append(style)

const now = Date.now()
// The comments of the reported screenshot: a queued one, one only waiting to sync, an answer.
const comments = [
    {
        id: 'queued',
        creatorId: 'karsten',
        lastChangeDate: now - 5 * 60000,
        commentText:
            'und der Assistant / Projektwechsel sollte auch andersrum klappen: Wenn ich im Assistant-Modus rechts im Bild in ein Projekt gehe, sollte links auch der richtige Assistent links ausgewählt werden.',
        pendingSend: { id: 'pending-1', userId: 'karsten', status: 'queued' },
    },
    {
        id: 'pending',
        creatorId: 'karsten',
        lastChangeDate: now - 4 * 60000,
        commentText: 'Noch eine Nachricht, die gerade synchronisiert wird.',
        pendingSend: { id: 'pending-2', userId: 'karsten', status: 'pending' },
    },
    {
        id: 'answer',
        creatorId: 'cto',
        lastChangeDate: now - 3 * 60000,
        commentText: 'Working with Claude (Opus 5.5 · high effort) in a VM…',
    },
]

// The popup card the task comments live in: RichCommentModal renders the real `CommentsList`
// inside a plain <div>. `data-ad-popup` gives it the popup palette in dark mode, exactly like the
// real popover container.
function App() {
    return (
        <div data-ad-popup="true" style={{ background: colors.Secondary400, padding: 16, minHeight: '100vh' }}>
            <div id="comment-list">
                <CommentsList
                    projectId="project-1"
                    objectType="tasks"
                    objectId="task-1"
                    comments={comments}
                    archivingEmailKeys={[]}
                    archivedEmailKeys={[]}
                />
            </div>
        </div>
    )
}

createRoot(document.getElementById('root')).render(
    <Provider
        store={createStore(() => ({ smallScreenNavigation: params.get('small') === '1', dateFormat: 'DD.MM.YYYY' }))}
    >
        <App />
    </Provider>
)
window.harnessReady = true
