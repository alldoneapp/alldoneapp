import 'setimmediate'
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import 'quill/dist/quill.snow.css'

import store from '../../redux/store'
import { startLoadingData, toggleSmallScreen, toggleSmallScreenNavigation, storeCurrentUser } from '../../redux/actions'
import '../../components/Anna/anna.css'
import { colors } from '../../components/styles/global'
import { useWorkspaceViewportOwner } from '../../hooks/useWorkspaceViewport'
import CustomScrollView from '../../components/UIControls/CustomScrollView'
import FloatingAddTaskButton from '../../components/TaskListView/FloatingAddTaskButton'
import LoadingData from '../../components/UIComponents/LoadingData'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'
import { installEscapeStack } from '../../utils/escapeStack'
import { ALL_PROJECTS_INDEX } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'

// AT-2911: the REAL floating "+" (FloatingAddTaskButton -> AddTaskTag -> AppPopover ->
// RichCreateTaskModal and its inner menus) and the REAL global loader, mounted with the
// real redux store inside the assistant shell's workspace column. The column is the
// AnnaShell markup (same class names, same CSS file, same viewport owner hook); the shell
// itself needs the chat transport and is exercised by browser-tests/anna-workspace.

const params = new URLSearchParams(window.location.search)
const projectId = 'project-1'
const user = {
    uid: 'user-1',
    displayName: 'Test user',
    email: 'test@example.com',
    photoURL: '',
    defaultProjectId: projectId,
    activeProjects: [projectId],
    inactiveProjects: [],
    projectIds: [projectId],
    archivedProjectIds: [],
    templateProjectIds: [],
    guideProjectIds: [],
    realProjectIds: [projectId],
    realArchivedProjectIds: [],
    realGuideProjectIds: [],
    realTemplateProjectIds: [],
    workstreams: {},
    premium: { status: 'FREE' },
    sidebarExpanded: true,
    showAllProjectsByTime: true,
}
store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch(storeCurrentUser(user))
store.dispatch({
    type: 'Set project initial data',
    project: {
        id: projectId,
        name: 'Launch',
        color: '#0D55CF',
        isShared: false,
        parentTemplateId: null,
        userIds: [user.uid],
        usersData: { [user.uid]: { role: '', company: '' } },
        sortIndexByUser: { [user.uid]: 0 },
    },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})
store.dispatch({ type: 'Switch project', index: params.has('allProjects') ? ALL_PROJECTS_INDEX : 0 })
// LoadingData shares the "+" baseline; keep it visible for the geometry checks.
store.dispatch(startLoadingData())
installEscapeStack()

// Same inputs as AppNavigator's responsive flags (outer view width, compact nav in assistant mode).
const syncResponsive = () => {
    const next = getResponsiveLayoutState({
        width: window.innerWidth,
        sidebarExpanded: true,
        preferCompactNavigation: true,
    })
    const state = store.getState()
    const actions = []
    if (state.smallScreen !== next.smallScreen) actions.push(toggleSmallScreen(next.smallScreen))
    if (state.smallScreenNavigation !== next.smallScreenNavigation)
        actions.push(toggleSmallScreenNavigation(next.smallScreenNavigation))
    if (actions.length) store.dispatch(actions)
}
syncResponsive()
window.addEventListener('resize', syncResponsive)

function WorkspaceColumn() {
    const content = useRef(null)
    const [working, setWorking] = useState(params.has('working'))
    const [chatOnly, setChatOnly] = useState(params.has('chatOnly'))
    const [fullscreen, setFullscreen] = useState(params.has('fullscreen'))
    const [chatWidth, setChatWidth] = useState(420)
    useEffect(() => {
        window.__setWorking = setWorking
        window.__setChatOnly = setChatOnly
        window.__setFullscreen = setFullscreen
        window.__setChatWidth = setChatWidth
    }, [])
    const active = !fullscreen
    const visibleWorkspace = active && !chatOnly
    useWorkspaceViewportOwner(content, active, visibleWorkspace)
    const mobile = window.innerWidth <= 760
    return (
        <div
            className={`anna-shell anna-zoom-shell ${
                active ? (chatOnly ? 'anna-zoom-active anna-chat-only' : 'anna-zoom-active') : 'anna-fullscreen'
            } anna-mobile-${chatOnly ? 'chat' : 'workspace'}`}
            style={{
                '--anna-chat-width': `${chatWidth}px`,
                '--anna-ink': colors.Text01,
                '--anna-muted': colors.Text02,
                '--anna-placeholder': colors.Text03,
                '--anna-accent': colors.Primary200,
                '--anna-border': colors.Grey300,
                '--anna-bezel': colors.Grey400,
                '--anna-focus': colors.UtilityBlue150,
                '--anna-surface': colors.Grey100,
            }}
        >
            <main className="anna-layout">
                <section className="anna-conversation" aria-label="Assistant chat">
                    <div style={{ padding: 24, font: '14px Roboto, Arial' }}>Chat pane</div>
                </section>
                <div className="anna-divider" role="separator" tabIndex={0} aria-orientation="vertical" />
                <section
                    className={`anna-stage ${working && visibleWorkspace && !mobile ? 'anna-stage-working' : ''}`}
                    aria-hidden={active && !visibleWorkspace}
                >
                    {working && visibleWorkspace && !mobile && (
                        <div className="anna-working-label" role="status">
                            <span className="anna-working-dot" aria-hidden="true" />
                            Anna is working here
                        </div>
                    )}
                    <div className="anna-workspace">
                        <div className="anna-workspace-content" ref={content}>
                            <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
                                <nav
                                    data-testid="sidebar"
                                    style={{
                                        width: mobile ? 0 : 56,
                                        flex: 'none',
                                        background: colors.Secondary400,
                                    }}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                    <header
                                        data-testid="topbar"
                                        style={{
                                            height: 56,
                                            flex: 'none',
                                            borderBottom: '1px solid #eee',
                                            font: '16px Roboto, Arial',
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '0 24px',
                                        }}
                                    >
                                        Tasks
                                    </header>
                                    <CustomScrollView
                                        nativeID="main-task-list-viewport"
                                        style={{ flex: 1 }}
                                        fixedChildren={<FloatingAddTaskButton />}
                                    >
                                        <div style={{ padding: '16px 24px', font: '14px Roboto, Arial' }}>
                                            {Array.from({ length: 40 }, (_, index) => (
                                                <div
                                                    key={index}
                                                    style={{ padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}
                                                >
                                                    ○ Task row {index + 1}
                                                </div>
                                            ))}
                                        </div>
                                    </CustomScrollView>
                                </div>
                            </div>
                            <LoadingData />
                        </div>
                    </div>
                </section>
            </main>
        </div>
    )
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <WorkspaceColumn />
    </Provider>
)
window.__ready = true
window.__taskCreationState = () => ({
    editors: store.getState().taskEditorCount,
    popups: store.getState().showFloatPopup,
})
