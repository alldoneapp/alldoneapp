import React, { useContext, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useSelector } from 'react-redux'
import { createRoot } from 'react-dom/client'
import AnnaShell from '../../components/Anna/AnnaShell'
import AssistantModeButton from '../../components/TopBar/AssistantModeButton'
import AnnaWorkspaceNavigationContext from '../../components/Anna/AnnaWorkspaceNavigationContext'
import { restoreAnnaLayout, setAnnaMode } from '../../utils/annaMode'
import { GlobalOverlayFixture, OverlayLaunchers } from './overlay-fixture'
import { getWorkspaceTasks, subscribeWorkspaceTasks } from './services'
import {
    getFollowedFeedAmount,
    getFollowedAndUnfollowedChatNotificationsAmount,
    resetNotificationsWhenUserHasAnActiveChat,
} from '../../utils/notificationBadges'
import alldoneFont from '../../assets/fonts/alldone.ttf'
import useModalSizing from '../../hooks/useModalSizing'
import LoadingData from '../../components/UIComponents/LoadingData'
import Quill from 'quill'
import Autoformat from '../../components/Feeds/CommentsTextInput/autoformat/modules/autoformat'
import 'quill/dist/quill.snow.css'
import NoteHeader from '../../components/NotesView/NotesDV/Header'
import NoteEditorContainer from '../../components/NotesView/NotesDV/EditorView/NoteEditorContainer'
import '../../components/NotesView/NotesDV/EditorView/toolbar-styles.css'
import {
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_VIEWPORT_GAP,
    getFloatingActionBottom,
} from '../../components/UIComponents/floatingActionLayout'
window.zoomAnna = setAnnaMode
restoreAnnaLayout()
// Keep real Quill insertion/serialization while isolating each visual embed
// from the production object's subscriptions and download transport.
const Embed = Quill.import('blots/embed')
for (const name of ['hashtag', 'mention', 'url', 'email', 'attachment', 'customImageFormat', 'videoFormat']) {
    class FixtureEmbed extends Embed {
        static create(value) {
            const node = super.create()
            node.dataset.value = JSON.stringify(value)
            node.textContent = value.text || value.url || value.email || ''
            return node
        }
        static value(node) {
            return JSON.parse(node.dataset.value)
        }
    }
    FixtureEmbed.blotName = name
    FixtureEmbed.tagName = 'span'
    FixtureEmbed.className = `fixture-${name}`
    Quill.register(FixtureEmbed, true)
}
Quill.register('modules/autoformat', Autoformat, true)
function ActivityHistoryFixture() {
    const feedCount = useSelector(getFollowedFeedAmount)
    const chats = useSelector(state => state.projectChatNotifications)
    const chatCount = getFollowedAndUnfollowedChatNotificationsAmount(
        true,
        '',
        resetNotificationsWhenUserHasAnActiveChat(chats, {}),
        [],
        []
    ).totalFollowed
    const receive = red => {
        const now = Date.now()
        window.__annaActivity({
            followedFeedsAmount: red ? 1 : 0,
            followedFeedsData: {
                p1: [
                    {
                        id: `feed-${now}`,
                        objectId: 'task1',
                        objectTypes: 'tasks',
                        lastChangeDate: now,
                        entryText: 'created task',
                    },
                ],
            },
            projectChatNotifications: {
                p1: {
                    totalFollowed: red ? 1 : 0,
                    totalUnfollowed: red ? 0 : 1,
                    other: { totalFollowed: 1, followedNotifications: [{ commentId: `message-${now}`, date: now }] },
                },
            },
        })
    }
    return (
        <div
            style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                zIndex: 10000,
                background: 'white',
                padding: 4,
                font: '12px Arial',
            }}
        >
            <output>
                Red updates: {feedCount || 0}; red chats: {chatCount || 0}
            </output>
            <button onClick={() => receive(false)}>Receive grey activity</button>
            <button onClick={() => receive(true)}>Receive red activity</button>
            <button
                onClick={() =>
                    window.__annaActivity({
                        followedFeedsAmount: 0,
                        followedFeedsData: {},
                        projectChatNotifications: {},
                    })
                }
            >
                Read notifications
            </button>
        </div>
    )
}
// Use the task board's shared action geometry without the task-creation transport.
function FloatingTaskActionFixture() {
    const { safeAreaInsets } = useModalSizing()
    return (
        <button
            data-testid="floating-task-action"
            aria-label="Add task layout fixture"
            style={{
                position: 'absolute',
                right: FLOATING_ACTION_VIEWPORT_GAP + safeAreaInsets.right,
                bottom: getFloatingActionBottom(safeAreaInsets.bottom),
                width: FLOATING_ACTION_SIZE,
                height: FLOATING_ACTION_SIZE,
                borderRadius: FLOATING_ACTION_SIZE / 2,
                border: 0,
                background: '#0066ff',
                color: 'white',
                fontSize: 28,
            }}
        >
            +
        </button>
    )
}
// Render the real detail header and editor container as siblings, as Sections
// does. Only DvContainer's mobile page gutter surrounds both of them.
function NoteWidthFixture() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    return (
        <View style={{ minWidth: 0, minHeight: 280, paddingHorizontal: mobile ? 16 : 0, paddingBottom: 40 }}>
            <div data-testid="note-header">
                <NoteHeader projectId="p1" note={{ id: 'note-layout', creatorId: 'demo' }} />
            </div>
            <NoteEditorContainer project={{ id: 'p1' }} note={{ id: 'note-layout', creatorId: 'demo' }} />
        </View>
    )
}
// Exercise the same navigation used by the sidebar independently of the mobile
// dropdown, whose Alldone option now exits assistant mode.
function WorkspaceNavigationFixture() {
    const showWorkspace = useContext(AnnaWorkspaceNavigationContext)
    useEffect(() => {
        window.__annaShowWorkspace = showWorkspace
        return () => delete window.__annaShowWorkspace
    }, [showWorkspace])
    return null
}
function Fixture() {
    const [dialog, setDialog] = useState(false)
    const [notifications, setNotifications] = useState(false)
    const [, refresh] = useState(0)
    useEffect(() => subscribeWorkspaceTasks(() => refresh(value => value + 1)), [])
    const noteFixture = new URLSearchParams(window.location.search).has('noteWidth')
    const revealFixture = new URLSearchParams(window.location.search).has('reveal')
    const revealListVisible =
        !new URLSearchParams(window.location.search).has('revealList') ||
        window.location.pathname === '/projects/p1/user/a1/tasks/open'
    return (
        <>
            <style>{`@font-face { font-family: alldone; src: url("${alldoneFont}") format("truetype"); }`}</style>
            {new URLSearchParams(window.location.search).has('notificationParity') && <ActivityHistoryFixture />}
            <GlobalOverlayFixture dialog={dialog} notifications={notifications} closeDialog={() => setDialog(false)} />
            <AnnaShell routeId="fixture-note">
                <WorkspaceNavigationFixture />
                <div style={{ display: 'flex', justifyContent: 'flex-end', background: 'white' }}>
                    <AssistantModeButton inline />
                </div>
                <ScrollView
                    testID="workspace-scroll"
                    style={{ flex: 1, minWidth: 0, backgroundColor: 'white' }}
                    contentContainerStyle={{ padding: noteFixture ? 0 : 32 }}
                >
                    {!noteFixture && (
                        <>
                            <span style={{ color: '#73827e', font: '14px Arial' }}>
                                Launch / Task notes · editable fixture
                            </span>
                            <h1 style={{ font: '28px Arial', color: '#243c38' }}>Prepare the launch</h1>
                            <p style={{ font: '16px Arial', lineHeight: 1.6 }}>
                                This fixture represents the same mounted Alldone editor in either layout.
                            </p>
                        </>
                    )}
                    {noteFixture ? (
                        <NoteWidthFixture />
                    ) : (
                        <textarea
                            aria-label="Workspace draft"
                            defaultValue="Launch notes: confirm the date with the team."
                            style={{
                                width: '100%',
                                minHeight: 180,
                                boxSizing: 'border-box',
                                font: '16px Arial',
                                padding: 20,
                            }}
                        />
                    )}
                    <button onClick={() => setAnnaMode(true)}>Zoom out to assistant</button>
                    <OverlayLaunchers
                        openGlobal={() => setDialog(true)}
                        toggleNotifications={() => {
                            window.__annaActivity({ connectionState: notifications ? 'online' : 'offline' })
                            setNotifications(value => !value)
                        }}
                    />
                    {revealFixture && revealListVisible && (
                        <div style={{ paddingTop: 30, font: '15px Arial', color: '#334155' }}>
                            <h2 style={{ fontSize: 20 }}>Launch tasks</h2>
                            {Array.from({ length: 24 }, (_, index) => (
                                <div key={index} style={{ padding: '20px 10px', borderBottom: '1px solid #edf0f4' }}>
                                    ○ &nbsp; Launch preparation {index + 1}
                                </div>
                            ))}
                            {getWorkspaceTasks().map(task => (
                                <View
                                    key={task.id}
                                    dataSet={{ annaObjectType: 'task', annaObjectId: task.id, annaProjectId: 'p1' }}
                                    style={{
                                        padding: 16,
                                        marginVertical: 12,
                                        backgroundColor: '#f9fafb',
                                        borderRadius: 8,
                                    }}
                                >
                                    <span style={{ fontSize: 16 }}>○ &nbsp; {task.title}</span>
                                    <span style={{ color: '#7d8798', fontSize: 13, padding: '8px 0 0 26px' }}>
                                        Alex · Launch
                                    </span>
                                </View>
                            ))}
                            <div style={{ height: 380 }} />
                        </div>
                    )}
                </ScrollView>
                {new URLSearchParams(window.location.search).has('floating') && (
                    <>
                        <FloatingTaskActionFixture />
                        <LoadingData />
                    </>
                )}
            </AnnaShell>
        </>
    )
}
createRoot(document.getElementById('root')).render(<Fixture />)
