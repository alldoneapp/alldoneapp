import React, { useEffect, useState, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import NotesEditorView from './NotesEditorView'
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
    // App-wide connectivity signal (OFFLINE_SUPPORT_PLAN.md Stage 1) — fed by
    // utils/connectionState.js. '' until the first transition, then 'offline' or
    // 'online' (the latter only as a recovery from 'offline'). The toast itself
    // renders globally in GlobalModalsContainerApp (ConnectionStateToast).
    const connectionState = useSelector(state => state.connectionState)
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

    useEffect(() => {
        // Offline no longer forces read-only (OFFLINE_SUPPORT_PLAN.md Stage 6):
        // y-indexeddb makes offline edits durable and CRDT merge-on-reconnect safe.
        const isReadOnly = !loggedUserCanUpdateObject
        dispatch(setActiveNoteIsReadOnly(isReadOnly))
        return () => {
            dispatch(setActiveNoteIsReadOnly(false))
        }
    }, [loggedUserCanUpdateObject])

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
                    readOnly={!loggedUserCanUpdateObject}
                    connectionState={connectionState}
                    objectType={objectType}
                    objectId={objectId}
                    object={object}
                    autoStartTranscription={autoStartTranscription}
                    onOpenSideChat={onOpenSideChat}
                />
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
