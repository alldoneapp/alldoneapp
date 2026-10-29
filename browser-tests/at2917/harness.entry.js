/**
 * AT-2917 browser harness — a narrow Assistant Mode chat pane must never scroll sideways.
 *
 * Mounts the REAL `AnnaMessageBody` (and through it the real `MessageItemBody`,
 * `CommentElementsParser`, `CustomImage`, `CodeText`, the markdown table scroller and the
 * inline tags) and the REAL `AnnaActivityGroup` inside the same DOM skeleton and the same
 * `anna.css` the assistant shell renders, at a chat width chosen by `run.js`. jsdom has no
 * layout, so whether `.anna-messages` grows a horizontal scroll range can only be measured
 * in a real browser.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import '../../components/Anna/anna.css'
import AnnaMessageBody from '../../components/Anna/AnnaMessageBody'
import AnnaMessageAuthor from '../../components/Anna/AnnaMessageAuthor'
import { AnnaActivityGroup } from '../../components/Anna/AnnaActivityNotice'

const PROJECT_ID = 'proj-1'
const UID = 'user-1'
const IMAGE = 'O2TI5plHBf1QfdY'
const ATTACHMENT = 'EbDsQTD14ahtSR5'

const user = {
    uid: UID,
    displayName: 'Karsten Wysk',
    email: 'k@e.st',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
    projectIds: [PROJECT_ID],
    isAnonymous: false,
    premium: { status: 'premium' },
}
store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: { id: PROJECT_ID, name: 'Alldone Product', color: '#0c66ff', isShared: false, parentTemplateId: null },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})

// A landscape screenshot, like the ones users paste into the assistant chat.
const canvas = document.createElement('canvas')
canvas.width = 1600
canvas.height = 900
const context = canvas.getContext('2d')
context.fillStyle = '#3d7bd9'
context.fillRect(0, 0, 1600, 900)
const screenshot = canvas.toDataURL('image/png')

const longWord = 'Supercalifragilisticexpialidocious'.repeat(4)
const MESSAGES = [
    {
        id: 'image',
        own: true,
        text: `Here is the screenshot ${IMAGE}${screenshot}${IMAGE}${screenshot}${IMAGE}Screenshot_2026-10-29_at_11.44.21.png${IMAGE}false`,
    },
    {
        id: 'attachment',
        own: true,
        text: `${ATTACHMENT}https://example.com/file.pdf${ATTACHMENT}A_really_long_attachment_file_name_without_any_spaces_quarterly_report_final_v3.pdf${ATTACHMENT}false`,
    },
    {
        id: 'code',
        text: [
            'Run this:',
            '```bash',
            'git push -u origin HEAD -o merge_request.create -o merge_request.target=master -o merge_request.title="A very long title"',
            '```',
        ].join('\n'),
    },
    {
        id: 'table',
        text: [
            '| Area | Before | After | Notes |',
            '| --- | --- | --- | --- |',
            '| Activity rows | Scrolled sideways | Fit the pane | Long titles are ellipsised |',
            '| Images | 384px wide | Pane width | Aspect ratio kept |',
        ].join('\n'),
    },
    { id: 'long-word', text: `A word that cannot wrap normally: ${longWord}` },
    {
        id: 'url',
        text: 'Link: https://firebasestorage.googleapis.com/v0/b/alldonealeph.appspot.com/o/feedAttachments%2F29102026%2F-P56FoPhbp_cv3uFkJxY%2FScreenshot.png',
    },
    { id: 'heading', text: `## ${longWord}` },
    {
        id: 'list',
        text: [
            'Changed files:',
            '- components/ChatsView/ChatDV/EditorView/MessageItemBody.js',
            `- ${longWord}`,
            `1. ${longWord}`,
            `- [x] ${longWord}`,
            '- An ordinary list item whose prose is long enough to wrap onto a second line in a narrow pane.',
        ].join('\n'),
    },
    {
        id: 'inline-with-image',
        own: true,
        text: `${longWord} ${IMAGE}${screenshot}${IMAGE}${screenshot}${IMAGE}shot.png${IMAGE}false`,
    },
    { id: 'quote', text: `> ${longWord}\n\nQuoted above.` },
]

const notice = (id, title, preview) => ({
    id,
    userId: UID,
    kind: 'chat',
    projectId: PROJECT_ID,
    sourceProjectId: PROJECT_ID,
    projectName: 'Alldone Product',
    created: Date.now() - 60000,
    objectId: 'task1',
    objectType: 'tasks',
    content: {
        version: 1,
        objectName: title,
        preview,
        actorName: 'Alldone CTO',
    },
})
const NOTICES = [
    notice(
        'n1',
        'einfach immer nur den aktuell geöffneten Chat zeigen und nicht alles andere drumherum',
        'Der VM-Lauf ist am 5-Stunden-Limit deines Claude-Abos gescheitert. Die Umsetzung ist noch offen.'
    ),
    notice('n2', longWord, `${longWord} ${longWord}`),
]

const assistant = { uid: 'a1', displayName: 'Anna Alldone', isAssistant: true }
const me = { uid: UID, displayName: 'Karsten Wysk' }

function Conversation() {
    return (
        <div className="anna-messages" role="log" tabIndex={0}>
            <div className="anna-message-timeline">
                <section>
                    <div className="anna-date-divider">2026-10-29 · Alldone Product with a rather long name</div>
                    {NOTICES.map(item => (
                        <AnnaActivityGroup key={item.id} notices={[item]} />
                    ))}
                    {MESSAGES.map(message => (
                        <article
                            key={message.id}
                            data-case={message.id}
                            className={`anna-message ${message.own ? 'anna-message-user' : ''}`}
                        >
                            <AnnaMessageAuthor
                                message={{ created: Date.now(), creatorId: message.own ? UID : 'a1' }}
                                creator={message.own ? me : assistant}
                                own={!!message.own}
                            />
                            <AnnaMessageBody
                                messageId={message.id}
                                projectId={PROJECT_ID}
                                commentText={message.text}
                                chat={{ id: 'chat1', projectId: PROJECT_ID }}
                                objectType="topics"
                                creatorData={message.own ? me : assistant}
                                isLoading={false}
                                containerStyle={{ margin: 0, padding: 0 }}
                            />
                        </article>
                    ))}
                </section>
            </div>
        </div>
    )
}

function Harness() {
    const width = Number(new URLSearchParams(window.location.search).get('width')) || 340
    return (
        <div className="anna-shell anna-zoom-shell" style={{ '--anna-chat-width': `${width}px` }}>
            <div className="anna-layout">
                <div className="anna-conversation">
                    <Conversation />
                </div>
                <div className="anna-divider" />
                <div className="anna-stage" />
            </div>
        </div>
    )
}

// Real listeners subscribe on mount; they need a client even though nothing ever answers.
initFirebase(() => {})
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)
