import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { setAssistantEnabled, setSelectedNavItem } from '../../../redux/actions'

import Header from './Header'
import NavigationBar from '../../NavigationBar/NavigationBar'
import NoteEditorContainer from './EditorView/NoteEditorContainer'
import PropertiesView from './PropertiesView/PropertiesView'
import { LINKED_OBJECT_TYPE_NOTE, LINKED_PARENT_NOTE } from '../../../utils/LinkingHelper'
import BacklinksView from '../../BacklinksView/BacklinksView'
import SharedHelper from '../../../utils/SharedHelper'
import {
    DV_TAB_NOTE_BACKLINKS,
    DV_TAB_NOTE_CHAT,
    DV_TAB_NOTE_EDITOR,
    DV_TAB_NOTE_PROPERTIES,
    DV_TAB_NOTE_UPDATES,
} from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import RootViewFeedsNote from '../../Feeds/RootViewFeedsNote'
import { FOLLOWER_NOTES_TYPE } from '../../Followers/FollowerConstants'
import ChatBoard from '../../ChatsView/ChatDV/ChatBoard'
import useFollowingDataListener from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/useFollowingDataListener'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { canOpenNoteSideChat, canShowNoteSideChat, getNoteSideChatWidth } from './sideChatHelper'

export default function Sections({ projectId, note, project, navigation, updateObjectState }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const [isFullscreen, setFullscreen] = useState(false)
    const [assistantId, setAssistantId] = useState(note?.assistantId || '')
    const [sideChatOpen, setSideChatOpen] = useState(false)
    const [contentWidth, setContentWidth] = useState(0)

    const [followState, updateFollowState] = useFollowingDataListener(projectId, FOLLOWER_NOTES_TYPE, note.id)

    const navigationTabs = [
        DV_TAB_NOTE_EDITOR,
        DV_TAB_NOTE_PROPERTIES,
        DV_TAB_NOTE_BACKLINKS,
        DV_TAB_NOTE_CHAT,
        DV_TAB_NOTE_UPDATES,
    ]

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    if (!accessGranted) {
        const indexBL = navigationTabs.indexOf(DV_TAB_NOTE_BACKLINKS)
        navigationTabs.splice(indexBL, 1)
    }

    useEffect(() => {
        setFullscreen(assistantEnabled)
    }, [assistantEnabled])

    useEffect(() => {
        setAssistantId(note?.assistantId || '')
    }, [note?.assistantId])

    useEffect(() => {
        if (selectedTab !== DV_TAB_NOTE_EDITOR) setSideChatOpen(false)
    }, [selectedTab])

    const sideChatAvailable = canShowNoteSideChat({ mobile, contentWidth })
    const sideChatWidth = getNoteSideChatWidth(contentWidth)
    const showSideChat = selectedTab === DV_TAB_NOTE_EDITOR && sideChatOpen && sideChatAvailable

    useEffect(() => {
        if (sideChatOpen && !sideChatAvailable) setSideChatOpen(false)
    }, [sideChatAvailable, sideChatOpen])

    const openSideChat = ({ objectType, objectId, projectId: toolbarProjectId }) => {
        if (
            !canOpenNoteSideChat({
                mobile,
                contentWidth,
                objectType,
                objectId,
                noteId: note.id,
                toolbarProjectId,
                projectId,
            })
        ) {
            return false
        }

        // The side chat lives in the editor tab, so make sure we are on it before opening
        // (e.g. when triggered from the header assistant button on another tab).
        if (selectedTab !== DV_TAB_NOTE_EDITOR) dispatch(setSelectedNavItem(DV_TAB_NOTE_EDITOR))
        setSideChatOpen(true)
        dispatch(setAssistantEnabled(true))
        return true
    }

    const onContentLayout = event => {
        const { width } = event.nativeEvent.layout
        if (width !== contentWidth) setContentWidth(width)
    }

    return (
        <View style={{ flexDirection: 'column', backgroundColor: 'white', flex: 1 }}>
            <Header
                projectId={projectId}
                note={note}
                assistantId={assistantId}
                setAssistantId={setAssistantId}
                navigation={navigation}
                isFullscreen={isFullscreen}
                disabled={
                    note.linkedToTemplate ||
                    (ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId) && loggedUser.uid !== note.creatorId)
                }
                setFullscreen={setFullscreen}
                updateObjectState={updateObjectState}
                onOpenSideChat={openSideChat}
            />

            {Object.keys(note) !== 0 && (
                <View style={{ flex: 1 }} onLayout={onContentLayout}>
                    {!isFullscreen && accessGranted && (
                        <View
                            style={
                                mobile
                                    ? localStyles.navigationBarMobile
                                    : isMiddleScreen
                                    ? localStyles.navigationBarTablet
                                    : localStyles.navigationBar
                            }
                        >
                            <NavigationBar isSecondary tabs={navigationTabs} />
                        </View>
                    )}
                    {(() => {
                        const linkedParentObject = {
                            type: LINKED_OBJECT_TYPE_NOTE,
                            id: note.id,
                            idsField: 'linkedParentNotesIds',
                        }
                        switch (selectedTab) {
                            case DV_TAB_NOTE_EDITOR:
                                return (
                                    <View style={localStyles.editorWithSideChat}>
                                        <View style={localStyles.editorPane}>
                                            <NoteEditorContainer
                                                project={project}
                                                note={note}
                                                isFullscreen={isFullscreen}
                                                setFullscreen={setFullscreen}
                                                followState={followState}
                                                objectType={FOLLOWER_NOTES_TYPE}
                                                object={note}
                                                objectId={note.id}
                                                navigation={navigation}
                                                onOpenSideChat={openSideChat}
                                            />
                                        </View>
                                        {showSideChat && (
                                            <View style={[localStyles.sideChat, { width: sideChatWidth }]}>
                                                <View style={localStyles.sideChatHeader}>
                                                    <Text style={[styles.subtitle2, localStyles.sideChatTitle]}>
                                                        {translate('Chat')}
                                                    </Text>
                                                    <TouchableOpacity
                                                        style={localStyles.sideChatCloseButton}
                                                        onPress={() => setSideChatOpen(false)}
                                                    >
                                                        <Icon name="x" size={20} color={colors.Text03} />
                                                    </TouchableOpacity>
                                                </View>
                                                <ChatBoard
                                                    chat={{ id: note.id, type: 'notes' }}
                                                    projectId={projectId}
                                                    parentObject={note}
                                                    chatTitle={note.title}
                                                    assistantId={assistantId}
                                                    setAssistantId={setAssistantId}
                                                    objectType={'notes'}
                                                />
                                            </View>
                                        )}
                                    </View>
                                )
                            case DV_TAB_NOTE_BACKLINKS:
                                return (
                                    <BacklinksView
                                        parentType={LINKED_PARENT_NOTE}
                                        project={project}
                                        parentObject={note}
                                        linkedParentObject={linkedParentObject}
                                    />
                                )
                            case DV_TAB_NOTE_PROPERTIES:
                                return <PropertiesView projectId={projectId} note={note} project={project} />
                            case DV_TAB_NOTE_UPDATES:
                                return <RootViewFeedsNote projectId={projectId} note={note} noteId={note.id} />
                            case DV_TAB_NOTE_CHAT:
                                return (
                                    <View style={{ flex: 1, marginHorizontal: mobile ? 0 : isMiddleScreen ? 56 : 104 }}>
                                        <ChatBoard
                                            chat={{ id: note.id, type: 'notes' }}
                                            projectId={projectId}
                                            parentObject={note}
                                            chatTitle={note.title}
                                            assistantId={assistantId}
                                            setAssistantId={setAssistantId}
                                            objectType={'notes'}
                                        />
                                    </View>
                                )
                        }
                    })()}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    navigationBarMobile: {
        marginHorizontal: -16,
    },
    navigationBarTablet: {
        marginHorizontal: 56,
    },
    navigationBar: {
        marginHorizontal: 104,
    },
    editorWithSideChat: {
        flex: 1,
        flexDirection: 'row',
    },
    editorPane: {
        flex: 1,
        minWidth: 0,
    },
    sideChat: {
        flexDirection: 'column',
        borderLeftWidth: 1,
        borderLeftColor: colors.Gray300,
        backgroundColor: 'white',
    },
    sideChatHeader: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: 16,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.Gray300,
    },
    sideChatTitle: {
        color: colors.Text01,
    },
    sideChatCloseButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
