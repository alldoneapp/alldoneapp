import React, { useEffect, useState, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import NotesEditorView from './NotesEditorView'
import ConnectionStateModal from '../../../UIComponents/FloatModals/ConnectionStateModal'
import {
    setActiveNoteId,
    setActiveNoteIsReadOnly,
    setNoteInnerTasks,
    removeNoteInnerTasks,
} from '../../../../redux/actions'
import Backend from '../../../../utils/BackendBridge'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import SharedHelper from '../../../../utils/SharedHelper'

export default function NoteEditorContainer({
    project,
    note,
    isFullscreen,
    setFullscreen,
    followState,
    objectType,
    objectId,
    object,
    navigation,
    autoStartTranscription: autoStartTranscriptionProp,
    onOpenSideChat,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUser = useSelector(state => state.loggedUser)
    const [editorKey, setEditorKey] = useState(v4())
    const dispatch = useDispatch()
    const [connectionState, setConnectionState] = useState('')
    let visibilityStateRef = useRef('visible')

    // Only members can edit the note body. Anonymous viewers and logged-in non-members get a
    // read-only editor, matching the note title (which is already gated on accessGranted).
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)
    const loggedUserIsCreator = loggedUserId === note.creatorId
    const loggedUserCanUpdateObject =
        accessGranted &&
        !note.linkedToTemplate &&
        (objectType === 'topics' ||
            loggedUserIsCreator ||
            !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id))

    // Use prop if provided, otherwise fall back to navigation param
    const autoStartTranscription =
        autoStartTranscriptionProp ?? (navigation ? navigation.getParam('autoStartTranscription') : false)

    const closeConnectionStateModal = () => {
        setConnectionState('')
    }

    useEffect(() => {
        const isReadOnly = connectionState === 'offline' || !loggedUserCanUpdateObject
        dispatch(setActiveNoteIsReadOnly(isReadOnly))
        return () => {
            dispatch(setActiveNoteIsReadOnly(false))
        }
    }, [connectionState, loggedUserCanUpdateObject])

    const updateInnerTasks = tasks => {
        dispatch(setNoteInnerTasks(note.id, tasks))
    }

    useEffect(() => {
        const watcherKey = v4()
        Backend.watchNoteInnerTasks(project.id, note.id, watcherKey, updateInnerTasks)
        return () => {
            Backend.unwatch(watcherKey)
            dispatch(removeNoteInnerTasks(note.id))
        }
    }, [])

    useEffect(() => {
        dispatch(setActiveNoteId(note.id))
        return () => {
            dispatch(setActiveNoteId(''))
        }
    }, [])

    return (
        <View style={localstyles.container}>
            {visibilityStateRef.current !== 'hidden' && (
                <NotesEditorView
                    key={editorKey}
                    project={project}
                    note={note}
                    isFullscreen={isFullscreen}
                    setFullscreen={setFullscreen}
                    followState={followState}
                    readOnly={connectionState === 'offline' || !loggedUserCanUpdateObject}
                    connectionState={connectionState}
                    objectType={objectType}
                    objectId={objectId}
                    object={object}
                    autoStartTranscription={autoStartTranscription}
                    onOpenSideChat={onOpenSideChat}
                />
            )}
            {(connectionState === 'online' || connectionState === 'offline') && (
                <ConnectionStateModal connectionState={connectionState} closeModal={closeConnectionStateModal} />
            )}
        </View>
    )
}

const localstyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        flex: 1,
    },
})
