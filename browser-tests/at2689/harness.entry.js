import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'
import { createStore } from 'redux'
import { View, Text } from 'react-native'
import NoteTags from '../../components/NotesView/NotesDV/TagList'
import TaskTags from '../../components/TaskDetailedView/Header/TagList'
import ContactTags from '../../components/ContactDetailedView/Header/TagList'
import UserTags from '../../components/UserDetailedView/Header/TagList'
import ChatTags from '../../components/ChatsView/ChatDV/TagList'
import { setLanguage } from '../../i18n/TranslationService'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'
import { SIDEBAR_MENU_COLLAPSED_WIDTH, SIDEBAR_MENU_WIDTH } from '../../components/styles/global'

const params = new URLSearchParams(window.location.search)
window.__project = {
    id: 'project-1',
    index: 0,
    name: params.get('name') || 'JTL Software - Project Juno',
    color: '#FF9856',
}
window.__shared = params.has('shared')
setLanguage(params.get('language') || 'de')
const loggedUser = { uid: 'owner', sidebarExpanded: params.has('expanded'), isAnonymous: window.__shared }
const viewers = ['owner', 'guest', 'third', 'fourth', 'fifth', 'sixth']
const projectUsers = {
    'project-1': viewers.map(uid => ({
        uid,
        photoURL:
            'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="%238A94A6"/></svg>',
    })),
}
const responsive = () =>
    getResponsiveLayoutState({
        width: window.innerWidth,
        sidebarExpanded: loggedUser.sidebarExpanded,
        route: 'NotesDetailedView',
    })
const store = createStore((state = { loggedUser, projectUsers, ...responsive() }, action) =>
    action.type === 'resize' ? { ...state, ...responsive() } : state
)
window.addEventListener('resize', () => store.dispatch({ type: 'resize' }))
const object = {
    id: 'object-1',
    uid: 'owner',
    userId: 'owner',
    recorderUserId: 'owner',
    isPublicFor: params.has('private') ? viewers : [0],
    recurrence: 'never',
    estimations: { open: 0 },
}

function Demo() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const sidebar =
        mobile || window.__shared ? 0 : loggedUser.sidebarExpanded ? SIDEBAR_MENU_WIDTH : SIDEBAR_MENU_COLLAPSED_WIDTH
    const margin = mobile ? 16 : tablet ? 56 : 104
    const rows = {
        note: <NoteTags projectId="project-1" note={object} />,
        task: (
            <TaskTags
                projectId="project-1"
                task={{
                    ...object,
                    ...(params.has('extras') && {
                        humanReadableId: 'AT-2689',
                        recurrence: 'daily',
                        estimations: { open: 1 },
                        userIds: ['owner'],
                    }),
                }}
            />
        ),
        contact: <ContactTags project={window.__project} contact={object} />,
        user: <UserTags project={window.__project} user={object} />,
        chat: <ChatTags projectId="project-1" chat={object} />,
    }
    return (
        <View style={{ marginLeft: sidebar, paddingHorizontal: margin, paddingVertical: 32 }}>
            {Object.entries(rows).map(([type, row]) => (
                <View
                    key={type}
                    testID={`header-${type}`}
                    style={{
                        marginBottom: 32,
                        ...(params.has('contentWidth') && { width: Number(params.get('contentWidth')) }),
                    }}
                >
                    <Text style={{ marginBottom: 16 }}>{type}</Text>
                    <View style={{ flexDirection: 'row' }}>{row}</View>
                </View>
            ))}
        </View>
    )
}
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Demo />
    </Provider>
)
