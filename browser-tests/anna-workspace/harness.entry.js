import React, { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { createRoot } from 'react-dom/client'
import AnnaShell from '../../components/Anna/AnnaShell'
import { setAnnaMode } from '../../utils/annaMode'
import { GlobalOverlayFixture, OverlayLaunchers } from './overlay-fixture'
import { getWorkspaceTasks, subscribeWorkspaceTasks } from './services'
import alldoneFont from '../../assets/fonts/alldone.ttf'
import useModalSizing from '../../hooks/useModalSizing'
import LoadingData from '../../components/UIComponents/LoadingData'
import {
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_VIEWPORT_GAP,
    getFloatingActionBottom,
} from '../../components/UIComponents/floatingActionLayout'
window.zoomAnna = setAnnaMode
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
function Fixture() {
    const [dialog, setDialog] = useState(false)
    const [notifications, setNotifications] = useState(false)
    const [, refresh] = useState(0)
    useEffect(() => subscribeWorkspaceTasks(() => refresh(value => value + 1)), [])
    const revealFixture = new URLSearchParams(window.location.search).has('reveal')
    return (
        <>
            <style>{`@font-face { font-family: alldone; src: url("${alldoneFont}") format("truetype"); }`}</style>
            <GlobalOverlayFixture dialog={dialog} notifications={notifications} closeDialog={() => setDialog(false)} />
            <AnnaShell routeId="fixture-note">
                <ScrollView
                    testID="workspace-scroll"
                    style={{ flex: 1, minWidth: 0, backgroundColor: 'white' }}
                    contentContainerStyle={{ padding: 32 }}
                >
                    <span style={{ color: '#73827e', font: '14px Arial' }}>Launch / Task notes · editable fixture</span>
                    <h1 style={{ font: '28px Arial', color: '#243c38' }}>Prepare the launch</h1>
                    <p style={{ font: '16px Arial', lineHeight: 1.6 }}>
                        This fixture represents the same mounted Alldone editor in either layout.
                    </p>
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
                    <button onClick={() => setAnnaMode(true)}>Zoom out to assistant</button>
                    <OverlayLaunchers
                        openGlobal={() => setDialog(true)}
                        toggleNotifications={() => setNotifications(value => !value)}
                    />
                    {revealFixture && (
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
