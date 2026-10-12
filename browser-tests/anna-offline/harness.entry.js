import React, { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'
import useAnnaConversation from '../../components/Anna/useAnnaConversation'
import useGetMessages from '../../hooks/Chats/useGetMessages'
import useAnnaDraft from '../../components/Anna/useAnnaDraft'
import { annaMessageCache } from '../../components/Anna/annaMessageCache'
import { installConnectionStateListener } from '../../utils/connectionState'
import { installAppResumeListener } from '../../utils/appResume'
import store from './transport'

installConnectionStateListener()
installAppResumeListener()

function Messages({ thread }) {
    const messages = useGetMessages(false, false, thread.projectId, thread.chatId, 'topics', 50, annaMessageCache)
    return (
        <section data-thread={thread.chatId}>
            {!messages.loaded && <p>Loading messages</p>}
            {messages.map(message => (
                <p data-message key={message.id}>
                    {message.commentText}
                </p>
            ))}
        </section>
    )
}
function Composer({ user, offline }) {
    const draft = useAnnaDraft({
        userId: user.uid,
        projectId: user.defaultProjectId,
        objectType: 'anna',
        objectId: 'draft',
    })
    return (
        <>
            <textarea
                aria-label="Draft"
                defaultValue={draft.initialText}
                onChange={event => draft.change(event.target.value)}
            />
            <button disabled={offline || !draft.hasText}>Send</button>
        </>
    )
}
function App() {
    const user = useSelector(state => state.loggedUser)
    const state = useAnnaConversation(user.uid, { user })
    useLayoutEffect(() => {
        if (!window.__firstPaint)
            window.__firstPaint = {
                messages: document.querySelectorAll('[data-message]').length,
                text: document.body.textContent,
            }
    }, [])
    return (
        <main>
            <h1>Assistant chat cache regression</h1>
            <p role="status">{state.offline ? 'Offline' : 'Online'}</p>
            {state.loading && <p>Loading conversation</p>}
            {state.threads.map(thread => (
                <Messages key={`${user.uid}/${thread.projectId}/${thread.chatId}`} thread={thread} />
            ))}
            <Composer key={user.uid} user={user} offline={state.offline} />
        </main>
    )
}
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
