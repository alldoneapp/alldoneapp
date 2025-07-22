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

export default function NoteEditorContainer({
    project,
    note,
    isFullscreen,
    setFullscreen,
    followState,
    objectType,
    objectId,
    object,
}) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [editorKey, setEditorKey] = useState(v4())
    const dispatch = useDispatch()
    const [connectionState, setConnectionState] = useState('')
    let visibilityStateRef = useRef('visible')

    const closeConnectionStateModal = () => {
        setConnectionState('')
    }

    useEffect(() => {
        const isReadOnly = connectionState === 'offline'
        dispatch(setActiveNoteIsReadOnly(isReadOnly))
        return () => {
            dispatch(setActiveNoteIsReadOnly(false))
        }
    }, [connectionState])

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

    const loggedUserIsCreator = loggedUserId === note.creatorId
    const loggedUserCanUpdateObject =
        !note.linkedToTemplate &&
        (objectType === 'topics' ||
            loggedUserIsCreator ||
            !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(project.id))

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
