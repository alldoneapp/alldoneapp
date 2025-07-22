import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import PropertiesHeader from './PropertiesHeader'
import Privacy from './Privacy'
import { useSelector, useStore } from 'react-redux'
import Highlight from './Highlight'
import Stickyness from './Stickyness'
import CreatedBy from '../../../TaskDetailedView/Properties/CreatedBy'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import URLsNotes, { URL_NOTE_DETAILS_PROPERTIES } from '../../../../URLSystem/Notes/URLsNotes'
import FollowObject from '../../../Followers/FollowObject'
import { FOLLOWER_NOTES_TYPE } from '../../../Followers/FollowerConstants'
import Project from '../../../TaskDetailedView/Properties/Project'
import DeleteNote from './DeleteNote'
import AssignedTo from './AssignedTo'
import SharedHelper from '../../../../utils/SharedHelper'
import { DV_TAB_NOTE_PROPERTIES } from '../../../../utils/TabNavigationConstants'
import Backend from '../../../../utils/BackendBridge'
import VersionHistory from './VersionHistory'
import SaveVersion from './SaveVersion'
import AssistantProperty from '../../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'
import { getUserData } from '../../../../utils/backends/Users/usersFirestore'

export default function PropertiesView({ projectId, note, project }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [creator, setCreator] = useState({})
    const selectedTab = useSelector(state => state.selectedNavItem)

    const store = useStore()
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_NOTE_PROPERTIES) {
            const data = { note: note.id, projectId: projectId }
            URLsNotes.push(URL_NOTE_DETAILS_PROPERTIES, data, projectId, note.id, note.title)
        }
    }

    useEffect(() => {
        writeBrowserURL()
    }, [projectId])

    useEffect(() => {
        writeBrowserURL()
        getUserData(note.creatorId, false).then(afterCreatorFetch)
    }, [])

    const afterCreatorFetch = user => {
        setCreator(user)
    }

    const loggedUserIsCreator = loggedUser.uid === note.creatorId
    const loggedUserCanUpdateObject =
        !note.linkedToTemplate &&
        (loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

    const isGuide = !!project.parentTemplateId

    return (
        <View
            style={
                mobile
                    ? localStyles.containerMobile
                    : isMiddleScreen
                    ? localStyles.containerTablet
                    : localStyles.container
            }
        >
            <PropertiesHeader />

            <View style={smallScreen ? localStyles.panelsContainerMobile : localStyles.panelsContainer}>
                <View style={smallScreen ? localStyles.leftContainerMobile : localStyles.leftContainer}>
                    <AssignedTo projectId={projectId} note={note} disabled={!accessGranted || isGuide} />
                    <Project item={{ type: 'note', data: note }} project={project} disabled={!accessGranted} />
                    <Highlight
                        projectId={projectId}
                        note={note}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                    <Stickyness
                        projectId={projectId}
                        note={note}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                </View>

                <View style={smallScreen ? localStyles.rightContainerMobile : localStyles.rightContainer}>
                    <AssistantProperty
                        projectId={projectId}
                        assistantId={note.assistantId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        objectId={note.id}
                        objectType={'notes'}
                    />
                    <Privacy
                        projectId={projectId}
                        note={note}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                    />
                    {accessGranted && (
                        <FollowObject
                            projectId={projectId}
                            followObjectsType={FOLLOWER_NOTES_TYPE}
                            followObjectId={note.id}
                            loggedUserId={store.getState().loggedUser.uid}
                            object={note}
                            disabled={!accessGranted}
                        />
                    )}
                    <CreatedBy createdDate={note.created} creator={creator} />

                    {accessGranted && loggedUserCanUpdateObject && (
                        <View style={localStyles.deleteButtonContainer}>
                            <SaveVersion projectId={projectId} note={note} />
                            <VersionHistory projectId={projectId} note={note} />
                            <DeleteNote projectId={projectId} note={note} />
                        </View>
                    )}
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        marginBottom: 92,
        marginHorizontal: 104,
    },
    containerMobile: {
        marginHorizontal: 0,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
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
        marginTop: 72,
    },
})
