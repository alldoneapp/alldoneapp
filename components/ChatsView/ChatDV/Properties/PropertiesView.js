import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Privacy from './Privacy'
import CreatedBy from '../../../TaskDetailedView/Properties/CreatedBy'
import Highlight from './Highlight'
import DeleteChat from './DeleteChat'
import Backend from '../../../../utils/BackendBridge'
import PropertiesHeader from './PropertiesHeader'
import { useSelector } from 'react-redux'
import FollowObject from '../../../Followers/FollowObject'
import SharedHelper from '../../../../utils/SharedHelper'
import { DV_TAB_CHAT_PROPERTIES } from '../../../../utils/TabNavigationConstants'
import URLsChats, { URL_CHAT_DETAILS_PROPERTIES } from '../../../../URLSystem/Chats/URLsChats'
import Stickyness from '../../../NotesView/NotesDV/PropertiesView/Stickyness'
import ObjectRevisionHistory from '../../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import { FOLLOWER_TOPICS_TYPE } from '../../../Followers/FollowerConstants'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { GUIDE_MAIN_CHAT_ID } from '../../../../utils/backends/Projects/guidesFirestore'
import AssistantProperty from '../../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'

export default function PropertiesView({ projectId, chat }) {
    const [creator, setCreator] = useState({})
    const smallScreen = useSelector(state => state.smallScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUser = useSelector(state => state.loggedUser)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    useEffect(() => {
        Backend.getUserOrContactBy(projectId, chat.creatorId).then(afterCreatorFetch)
        writeBrowserURL()
    }, [])

    const afterCreatorFetch = user => {
        setCreator(user)
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_CHAT_PROPERTIES) {
            const data = { projectId, chatId: chat.id }
            URLsChats.push(URL_CHAT_DETAILS_PROPERTIES, data, projectId, chat.id)
        }
    }

    const loggedUserCanUpdateObject =
        GUIDE_MAIN_CHAT_ID !== chat.id || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={{ flexDirection: 'column', marginBottom: 92 }}>
            <PropertiesHeader />

            <View style={smallScreen ? localStyles.panelsContainerMobile : localStyles.panelsContainer}>
                <View style={smallScreen ? localStyles.leftContainerMobile : localStyles.leftContainer}>
                    <CreatedBy createdDate={chat.created} creator={creator} />
                    <Highlight chat={chat} projectId={projectId} disabled={!accessGranted} />
                    <Stickyness projectId={projectId} note={chat} disabled={!accessGranted} isChat />
                </View>

                <View style={smallScreen ? localStyles.rightContainerMobile : localStyles.rightContainer}>
                    <AssistantProperty
                        projectId={projectId}
                        assistantId={chat.assistantId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        objectId={chat.id}
                        objectType={'chats'}
                    />
                    <Privacy projectId={projectId} chat={chat} disabled={!accessGranted} />
                    {accessGranted && (
                        <FollowObject
                            projectId={projectId}
                            followObjectsType={FOLLOWER_TOPICS_TYPE}
                            followObjectId={chat.id}
                            loggedUserId={loggedUser.uid}
                            object={chat}
                            disabled={!accessGranted}
                        />
                    )}
                </View>
            </View>

            {accessGranted && loggedUserCanUpdateObject && (
                <View style={localStyles.deleteButtonContainer}>
                    <ObjectRevisionHistory projectId={projectId} noteId={chat.noteId} />
                    <DeleteChat projectId={projectId} chat={chat} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    panelsContainer: {
        flex: 1,
        flexDirection: 'row',
        position: 'relative',
        zIndex: 50,
    },
    panelsContainerMobile: {
        flex: 1,
        flexDirection: 'column',
        position: 'relative',
        zIndex: 50,
    },
    leftContainer: {
        flex: 1,
        flexDirection: 'column',
        paddingRight: 36,
    },
    leftContainerMobile: {
        flex: 1,
        flexDirection: 'column',
    },
    rightContainer: {
        flex: 1,
        flexDirection: 'column',
        paddingLeft: 36,
    },
    rightContainerMobile: {
        flex: 1,
        flexDirection: 'column',
    },
    deleteButtonContainer: {
        marginTop: 24,
    },
})
