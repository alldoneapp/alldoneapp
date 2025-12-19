import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import BackButton from './BackButton'
import SharedHelper from '../../../utils/SharedHelper'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { DV_TAB_NOTE_CHAT, DV_TAB_NOTE_EDITOR } from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import WrapperMentionsModal from '../../Feeds/CommentsTextInput/WrapperMentionsModal'
import {
    getQuill,
    insertNormalMention,
    mentionText,
    selectionBounds,
    selectItemToMention,
    setMentionModalHeight,
    showMentionPopup,
    loadFlag,
} from './EditorView/mentionsHelper'
import { MANAGE_TASK_MODAL_ID } from '../../ModalsManager/modalsManager'
import TaskTagWrapper from '../../Feeds/CommentsTextInput/autoformat/tags/TaskTagWrapper'
import Sections from './Sections'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../../styles/global'
import useCollapsibleSidebar from '../../SidebarMenu/Collapsible/UseCollapsibleSidebar'

export default function DvContainer({ projectId, note, navigation, updateObjectState }) {
    const openModals = useSelector(state => state.openModals)
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [flag, setFlag] = useState(false)

    const project = ProjectHelper.getProjectById(projectId)

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const { overlay } = useCollapsibleSidebar()

    const CustomView = selectedTab === DV_TAB_NOTE_CHAT ? View : CustomScrollView

    useEffect(() => {
        loadFlag(setFlag)
        return () => {
            loadFlag(null)
        }
    }, [])

    return (
        <>
            {selectedTab === DV_TAB_NOTE_EDITOR ? (
                <View style={{ flex: 1 }}>
                    {accessGranted && !isMiddleScreen && (
                        <View style={[localStyles.backButton, overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH }]}>
                            <BackButton projectId={projectId} note={note} />
                        </View>
                    )}

                    <View
                        style={[
                            localStyles.scrollPanel,
                            mobile ? localStyles.scrollPanelMobile : null,
                            overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                        ]}
                    >
                        {!!note && !!project && (
                            <Sections
                                navigation={navigation}
                                projectId={projectId}
                                note={note}
                                project={project}
                                updateObjectState={updateObjectState}
                            />
                        )}
                        {showMentionPopup && (
                            <WrapperMentionsModal
                                mentionText={mentionText}
                                selectItemToMention={selectItemToMention}
                                insertNormalMention={insertNormalMention}
                                projectId={projectId}
                                contentLocation={selectionBounds}
                                setMentionModalHeight={setMentionModalHeight}
                                keepFocus={() => {
                                    getQuill().current.focus()
                                }}
                            />
                        )}
                        {openModals[MANAGE_TASK_MODAL_ID] && !openModals[MANAGE_TASK_MODAL_ID].inTag && (
                            <TaskTagWrapper
                                editorId={note.id}
                                contentLocation={selectionBounds}
                                setModalHeight={setMentionModalHeight}
                            />
                        )}
                    </View>
                </View>
            ) : (
                <CustomView
                    style={[
                        localStyles.scrollPanel,
                        mobile ? localStyles.scrollPanelMobile : null,
                        overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH },
                    ]}
                >
                    {accessGranted && !isMiddleScreen && (
                        <View style={localStyles.backButton}>
                            <BackButton projectId={projectId} note={note} />
                        </View>
                    )}

                    {!!note && !!project && (
                        <Sections
                            navigation={navigation}
                            projectId={projectId}
                            note={note}
                            project={project}
                            updateObjectState={updateObjectState}
                        />
                    )}
                </CustomView>
            )}
        </>
    )
}

const localStyles = StyleSheet.create({
    backButton: {
        position: 'absolute',
        top: 0,
        left: 32,
        zIndex: 100,
    },
    scrollPanel: {
        flex: 1,
        flexDirection: 'column',
        backgroundColor: 'white',
    },
    scrollPanelMobile: {
        paddingHorizontal: 16,
    },
})
