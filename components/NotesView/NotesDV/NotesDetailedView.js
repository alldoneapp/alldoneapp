import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import CustomSideMenu from '../../SidebarMenu/CustomSideMenu'
import Backend from '../../../utils/BackendBridge'
import LoadingNoteData from '../../UIComponents/LoadingNoteData'
import LoadingData from '../../UIComponents/LoadingData'

import {
    resetFloatPopup,
    setNavigationRoute,
    setSelectedNote,
    setShowAccessDeniedPopup,
    showNoteChangedNotification,
    startLoadingData,
    stopLoadingData,
    triggerWatchTasks,
    unsetSharedMode,
    storeCurrentUser,
    navigateToAllProjectsTasks,
} from '../../../redux/actions'
import store from '../../../redux/store'
import SharedHelper from '../../../utils/SharedHelper'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import NavigationService from '../../../utils/NavigationService'
import usePrivateProject from '../../../hooks/usePrivateProject'
import GoldAnimationsContainer from '../../RootView/GoldAnimationsContainer'
import { increaseNoteViews } from '../../../utils/backends/Notes/notesFirestore'
import { PROJECT_TYPE_SHARED } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import DvContainer from './DvContainer'

export default function NotesDetailedView({ navigation }) {
    const dispatch = useDispatch()
    const noteId = navigation.getParam('noteId', undefined)
    const projectId = navigation.getParam('projectId', undefined)

    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const showWebSideBar = useSelector(state => state.showWebSideBar)
    const [note, setNote] = useState(null)

    const { isAnonymous } = loggedUser

    usePrivateProject(projectId)

    const redirectOut = showAccessDeniedModal => {
        if (isAnonymous) {
            SharedHelper.redirectToPrivateResource()
        } else {
            const { selectedTypeOfProject } = store.getState()
            NavigationService.navigate('Root')
            dispatch([resetFloatPopup(), stopLoadingData(), navigateToAllProjectsTasks()])
            if (selectedTypeOfProject !== PROJECT_TYPE_SHARED && showAccessDeniedModal)
                dispatch(setShowAccessDeniedPopup(true))
        }
    }

    const checkIfIsPrivateNote = isPublicFor => {
        const isPrivateForUser =
            !isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && (isAnonymous || !isPublicFor.includes(loggedUser.uid))
        return isPrivateForUser
    }

    const checkNoteLastState = () => {
        setTimeout(() => {
            const callback = objects => {
                dispatch(showNoteChangedNotification(objects))
            }
            Backend.getLastObjectFeed(projectId, 'notes', noteId, 3, callback)
        }, 2500)
    }

    const updateNote = noteUpdated => {
        if (noteUpdated) {
            const isPrivateForUser = checkIfIsPrivateNote(noteUpdated.isPublicFor)
            if (isPrivateForUser) {
                redirectOut(true)
            } else {
                setNote(noteUpdated)
                dispatch(setSelectedNote(noteUpdated))
            }
        } else {
            //checkNoteLastState()
            redirectOut(false)
        }
    }

    useEffect(() => {
        Backend.watchNote(projectId, noteId, updateNote)
        return () => {
            Backend.unwatchNote(projectId, noteId)
        }
    }, [projectId, noteId])

    useEffect(() => {
        const { currentUser } = store.getState()

        Backend.logEvent('open_note', { uid: loggedUser.uid, id: noteId })
        increaseNoteViews(projectId, noteId)

        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
        TasksHelper.changeSharedMode(accessGranted)

        if (!!currentUser.recorderUserId || !!currentUser.temperature) dispatch(storeCurrentUser(loggedUser))
        dispatch([setNavigationRoute('NotesDetailedView'), startLoadingData()])

        return () => {
            dispatch([triggerWatchTasks(), unsetSharedMode(), setSelectedNote({})])
        }
    }, [])

    return (
        <View style={localStyles.container}>
            <LoadingData />
            <LoadingNoteData />

            {((!loggedUser.isAnonymous && !mobile) || (loggedUser.isAnonymous && mobile && showWebSideBar.visible)) && (
                <CustomSideMenu navigation={navigation} isWeb />
            )}

            {note && <DvContainer navigation={navigation} projectId={projectId} note={note} />}

            {!mobile && loggedUser.isAnonymous && <CustomSideMenu navigation={navigation} isWeb />}
            <GoldAnimationsContainer />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: 'white',
    },
})
