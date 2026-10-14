import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import AssistantOptions from '../../components/MyDayView/AssistantLine/AssistantOptions/AssistantOptions'
import AssistantInputLine from '../../components/TaskListView/OpenTasksView/OpenTaskViewForAssistants/AssistantInputLine'
// Match the application's Quill CSS, including its borderless input container.
import '../../components/NotesView/NotesDV/EditorView/toolbar-styles.css'
import Quill from 'quill'
import Autoformat from '../../components/Feeds/CommentsTextInput/autoformat/modules/autoformat'
import robotoFont from '../../assets/fonts/Roboto-Regular.ttf'
import iconFont from '../../assets/fonts/alldone.ttf'

// Text layout uses real Quill/autoformat; embedded object renderers are outside
// this harness. Their insertion/upload paths have dedicated component tests.
const Embed = Quill.import('blots/embed')
for (const name of ['hashtag', 'mention', 'url', 'email', 'attachment', 'customImageFormat', 'videoFormat']) {
    class FixtureEmbed extends Embed {}
    FixtureEmbed.blotName = name
    FixtureEmbed.tagName = 'span'
    Quill.register(FixtureEmbed, true)
}
Quill.register('modules/autoformat', Autoformat, true)

const assistant = { uid: 'anna-fixture', displayName: 'Anna Alldone', photoURL300: '' }
const board = new URLSearchParams(window.location.search).has('board')

createRoot(document.getElementById('root')).render(
    <>
        <style>{`
            @font-face { font-family: Roboto-Regular; src: url('${robotoFont}'); }
            @font-face { font-family: alldone; src: url('${iconFont}'); }
            html, body { margin: 0; font-family: Roboto-Regular; }
            [dir=auto] { font-family: Roboto-Regular; }
            .fixture-card { margin: 16px; padding: 14px 16px 12px 10px; background: #f1f3f4; border-radius: 4px; }
        `}</style>
        {board ? (
            <div style={{ margin: 16 }}>
                <AssistantInputLine assistant={assistant} projectId="fixture-project" />
            </div>
        ) : (
            <div className="fixture-card">
                <AssistantOptions />
            </div>
        )}
    </>
)
