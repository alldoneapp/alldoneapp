/**
 * AT-2361 browser regression harness — entry point.
 *
 * "On mobile don't 'waste' so much space on the left side of the screen when you show the email
 *  comments."
 *
 * The defect is a horizontal measurement, so Jest cannot see it: jsdom implements no layout, so
 * every box there is 0x0 and a margin that cancels a sibling column is indistinguishable from one
 * that does not (see browser-tests/README.md). This harness therefore renders the REAL chat-list
 * row — `ChatItem`, with the real `ChatHeaderItem` avatar column, the real `ChatItemUnreadMessages`
 * preview, the real `ChatItemUnreadMessage` rows and the real `MessageItemBody` with its linked-
 * email action buttons — and `run.js` measures `getBoundingClientRect().left` in real Chromium.
 *
 * The only thing doubled is the data source: `useGetMessages` subscribes to Firestore through
 * `watchComments`, and the harness has no backend, so that one function is replaced with a
 * synchronous snapshot of three Gmail-derived comments. Everything on the layout path under test
 * is the app's own code.
 */
import 'setimmediate'
import React from 'react'
import { View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import * as chatsComments from '../../utils/backends/Chats/chatsComments'
import { toggleSmallScreenNavigation } from '../../redux/actions'

const PROJECT_ID = 'proj-1'
const CHAT_ID = 'chat-1'
const UID = 'user-1'

const user = {
    uid: UID,
    displayName: 'Anna Alldone',
    email: 'anna@alldone.app',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
    // SharedHelper.accessGranted reads this; without it the email action row (the widest thing in
    // the preview, and half of what the complaint is about) never renders.
    projectIds: [PROJECT_ID],
    isAnonymous: false,
}

// The three emails from the reported screenshot, close enough in length that the wrapping is
// representative: a long sender line, a chip, and a multi-line summary.
const MESSAGES = [
    {
        id: 'c1',
        creatorId: UID,
        commentText:
            'Email from LinkedIn Jobbenachrichtigungen Job alert digest for "head of innovation" roles in Germany, including senior R&D, portfolio, product development, venture, and innovation-related positions.',
        lastChangeDate: Date.now() - 2 * 60 * 60 * 1000,
        created: Date.now() - 2 * 60 * 60 * 1000,
        gmailData: {
            messageId: 'gm-1',
            gmailEmail: 'anna@alldone.app',
            connectionId: 'email_google_anna',
            unsubscribeUrl: 'https://example.com/unsubscribe',
        },
    },
    {
        id: 'c2',
        creatorId: UID,
        commentText:
            'Email from Apple Rechnung über 2,99 € für die monatliche Verlängerung des iCloud+-Abos mit 200 GB.',
        lastChangeDate: Date.now() - 60 * 60 * 1000,
        created: Date.now() - 60 * 60 * 1000,
        gmailData: { messageId: 'gm-2', gmailEmail: 'anna@alldone.app', connectionId: 'email_google_anna' },
    },
    {
        id: 'c3',
        creatorId: UID,
        commentText:
            'Email from That1AI+Newsletter Weekly AI newsletter covering four new ChatGPT updates, Cursor Origin, Qwen’s download growth, and practical guidance on ChatGPT Computer History.',
        lastChangeDate: Date.now() - 30 * 60 * 1000,
        created: Date.now() - 30 * 60 * 1000,
        gmailData: {
            messageId: 'gm-3',
            gmailEmail: 'anna@alldone.app',
            connectionId: 'email_google_anna',
            unsubscribeUrl: 'https://example.com/unsubscribe',
        },
    },
]

// `useGetMessages` reads `watchComments` off the module object at call time, so replacing the
// property here — before anything mounts — is enough, and no build-level aliasing is needed.
chatsComments.watchComments = (projectId, chatType, objectId, watcherKey, toRender, handleSnapshot) => {
    setTimeout(() => handleSnapshot(MESSAGES), 0)
}
chatsComments.markChatMessagesAsRead = () => {}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: { id: PROJECT_ID, name: 'Privat', color: '#3E9AFF', isShared: false, parentTemplateId: null },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})
store.dispatch({
    type: 'Set chat notifications in projects',
    projectId: PROJECT_ID,
    notifications: MESSAGES.map((message, index) => ({
        chatId: CHAT_ID,
        followed: true,
        commentId: message.id,
        date: Date.now() - (MESSAGES.length - index) * 1000,
    })),
})

const params = new URLSearchParams(window.location.search)
const mobile = params.get('mobile') === '1'
store.dispatch(toggleSmallScreenNavigation(mobile))

initFirebase()

const chat = {
    id: CHAT_ID,
    type: 'topics',
    title: 'Daily emails Privat 18.08.2026',
    // Every chat doc carries one; `getChatItemBackgroundColor` lowercases it unconditionally.
    hasStar: '#FFFFFF',
    members: [UID, UID],
    stickyData: { days: 0 },
    lastEditionDate: Date.now(),
    commentsData: { lastCommentOwnerId: UID, lastComment: 'Email from Apple' },
}

// `ChatItem` is imported after the store is seeded so its module-level reads (themes, project
// colors) see a populated store, exactly as they do in the app where login precedes the list.
const ChatItem = require('../../components/ChatsView/ChatItem').default

function Harness() {
    return (
        // The chat list's own content column: `ChatsView` pads the page, and the row spans it.
        // Nothing here participates in the measurement except its width, which is what the row's
        // children divide up.
        <View nativeID="chat-list-column" style={{ paddingHorizontal: 16, width: '100%' }}>
            <ChatItem chat={chat} project={{ id: PROJECT_ID, name: 'Privat', color: '#3E9AFF' }} />
        </View>
    )
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)

// `run.js` waits for this: the preview only exists once the (async) snapshot has arrived.
setTimeout(() => {
    window.__ready = true
}, 400)
