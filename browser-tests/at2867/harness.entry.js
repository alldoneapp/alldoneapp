/**
 * AT-2867 browser harness: the owning project's name above the object row of a comment popup.
 *
 * Mounts the REAL `CommentPopupProjectLine` and the REAL popup `CloseButton` (the fixed
 * expand + close buttons in the popup's top-right corner) inside a box with the comment popup's
 * own geometry (RichCommentModal: container padding 8 + innerContainer padding 8), followed by a
 * task-row stand-in. jsdom computes no layout, so only a real browser can show whether a long
 * project name truncates on one line and stays clear of the corner buttons.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleSheet, Text, View } from 'react-native'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'

import { colors } from '../../components/styles/global'
import CommentPopupProjectLine from '../../components/UIComponents/FloatModals/RichCommentModal/CommentPopupProjectLine'
import CloseButton from '../../components/UIComponents/FloatModals/RichCommentModal/CloseButton'

const params = new URLSearchParams(window.location.search)
const longName = params.get('name') === 'long'

const store = createStore(() => ({
    selectedProjectIndex: 0,
    loggedUserProjectsMap: {
        // The selected project is a different one on purpose: the line must name the task's project.
        'selected-project': { id: 'selected-project', name: 'Alldone Product', index: 0 },
        'task-project': {
            id: 'task-project',
            index: 1,
            name: longName
                ? 'JTL Software – Juno Connect Enterprise Rollout and Partner Marketplace Readiness Program 2026'
                : 'JTL Software',
        },
    },
}))

function Popup() {
    return (
        <View testID="popup" style={localStyles.popup}>
            <View style={localStyles.inner}>
                <CommentPopupProjectLine projectId="task-project" />
                <View testID="task-row" style={localStyles.taskRow}>
                    <View style={localStyles.checkbox} />
                    <Text numberOfLines={1} style={localStyles.taskTitle}>
                        Optional: Bring Juno MCP to Codex and Claude Desktop for the public beta
                    </Text>
                </View>
                <View style={localStyles.composer}>
                    <Text style={{ color: colors.Text03 }}>Tippen, um einen Kommentar hinzuzufügen</Text>
                </View>
            </View>
            <CloseButton closeModal={() => {}} comments={[]} openChat={() => {}} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    popup: {
        position: 'relative',
        margin: 16,
        maxWidth: 560,
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    inner: { paddingHorizontal: 8, paddingVertical: 8 },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        paddingHorizontal: 8,
        borderRadius: 4,
        marginBottom: 20,
        backgroundColor: colors.Secondary200,
    },
    checkbox: { width: 24, height: 24, borderRadius: 4, backgroundColor: '#fff', marginRight: 12 },
    taskTitle: { color: '#fff', fontSize: 18, flexShrink: 1 },
    composer: { height: 72, borderRadius: 4, padding: 16, backgroundColor: colors.Secondary300 },
})

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Popup />
    </Provider>
)
