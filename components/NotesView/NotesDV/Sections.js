import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

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

export default function Sections({ projectId, note, project, navigation, updateObjectState }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const [isFullscreen, setFullscreen] = useState(false)

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

    return (
        <View style={{ flexDirection: 'column', backgroundColor: 'white', flex: 1 }}>
            <Header
                projectId={projectId}
                note={note}
                navigation={navigation}
                isFullscreen={isFullscreen}
                disabled={
                    note.linkedToTemplate ||
                    (ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId) && loggedUser.uid !== note.creatorId)
                }
                setFullscreen={setFullscreen}
                updateObjectState={updateObjectState}
            />

            {Object.keys(note) !== 0 && (
                <View style={{ flex: 1 }}>
                    {!isFullscreen && (
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
                                    />
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
                                            assistantId={note.assistantId}
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
})
