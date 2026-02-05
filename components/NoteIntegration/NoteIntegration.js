import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import NoteEditorContainer from '../NotesView/NotesDV/EditorView/NoteEditorContainer'
import useFollowingDataListener from '../UIComponents/FloatModals/MorePopupsOfEditModals/Common/useFollowingDataListener'
import { FOLLOWER_NOTES_TYPE } from '../Followers/FollowerConstants'
import Button from '../UIControls/Button'
import Backend from '../../utils/BackendBridge'
import { setSelectedNote, startLoadingData, stopLoadingData } from '../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import { createNoteInObject } from '../../utils/backends/firestore'
import {
    DV_TAB_ASSISTANT_NOTE,
    DV_TAB_CHAT_NOTE,
    DV_TAB_CONTACT_NOTE,
    DV_TAB_GOAL_NOTE,
    DV_TAB_SKILL_NOTE,
    DV_TAB_TASK_NOTE,
    DV_TAB_USER_NOTE,
} from '../../utils/TabNavigationConstants'
import URLsTasks, { URL_TASK_DETAILS_NOTE } from '../../URLSystem/Tasks/URLsTasks'
import LoadingNoteData from '../UIComponents/LoadingNoteData'
import URLsGoals, { URL_GOAL_DETAILS_NOTE } from '../../URLSystem/Goals/URLsGoals'
import URLsPeople, { URL_PEOPLE_DETAILS_NOTE } from '../../URLSystem/People/URLsPeople'
import URLsContacts, { URL_CONTACT_DETAILS_NOTE } from '../../URLSystem/Contacts/URLsContacts'
import URLsChats, { URL_CHAT_DETAILS_NOTE } from '../../URLSystem/Chats/URLsChats'
import styles, { colors } from '../styles/global'
import { MANAGE_TASK_MODAL_ID } from '../ModalsManager/modalsManager'
import TaskTagWrapper from '../Feeds/CommentsTextInput/autoformat/tags/TaskTagWrapper'
import {
    getQuill,
    insertNormalMention,
    loadFlag,
    mentionText,
    selectionBounds,
    selectItemToMention,
    setMentionModalHeight,
    showMentionPopup,
} from '../NotesView/NotesDV/EditorView/mentionsHelper'
import WrapperMentionsModal from '../Feeds/CommentsTextInput/WrapperMentionsModal'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../i18n/TranslationService'
import URLsSkills, { URL_SKILL_DETAILS_NOTE } from '../../URLSystem/Skills/URLsSkills'
import SharedHelper from '../../utils/SharedHelper'
import URLsAssistants, { URL_ASSISTANT_DETAILS_NOTE } from '../../URLSystem/Assistants/URLsAssistants'
import { increaseNoteViews } from '../../utils/backends/Notes/notesFirestore'

const NoteIntegration = ({
    project,
    noteId,
    object,
    objectId,
    objectName,
    isFullscreen,
    setFullscreen,
    objectType,
    objectPrivacy,
    hideCreateNoteSection,
    creatorId,
    isInGlobalProject,
    autoStartTranscription,
}) => {
    const dispatch = useDispatch()
    const openModals = useSelector(state => state.openModals)
    const loggedUser = useSelector(state => state.loggedUser)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const mobileCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const [note, setNote] = useState(null)
    const [isCreating, setIsCreating] = useState(false)
    const [followState, updateFollowState] = useFollowingDataListener(project.id, FOLLOWER_NOTES_TYPE, note?.id)
    const [flag, setFlag] = useState(false)
    const viewCountedRef = useRef(null)

    const projectIndex = ProjectHelper.getProjectIndexById(project.id)
    const accessGranted = isInGlobalProject || SharedHelper.accessGranted(loggedUser, project.id)

    useEffect(() => {
        if (noteId) {
            dispatch(startLoadingData())
            Backend.watchNote(project.id, noteId, note => {
                dispatch([stopLoadingData(), setSelectedNote(note)])
                setNote(note)
                if (note && viewCountedRef.current !== noteId) {
                    viewCountedRef.current = noteId
                    increaseNoteViews(project.id, noteId)
                }
            })
            return () => {
                Backend.unwatchNote(project.id, noteId)
                setSelectedNote({})
            }
        }
    }, [noteId])

    useEffect(() => {
        loadFlag(setFlag)
        writeBrowserURL()
        return () => {
            loadFlag(null)
        }
    }, [])

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_TASK_NOTE) {
            const data = { projectId: project.id, task: objectId }
            URLsTasks.push(URL_TASK_DETAILS_NOTE, data, project.id, objectId)
        } else if (selectedTab === DV_TAB_GOAL_NOTE) {
            const data = { projectId: project.id, goal: objectId }
            URLsGoals.push(URL_GOAL_DETAILS_NOTE, data, project.id, objectId)
        } else if (selectedTab === DV_TAB_USER_NOTE) {
            const data = { projectId: project.id, userId: objectId }
            URLsPeople.push(URL_PEOPLE_DETAILS_NOTE, data, project.id, objectId)
        } else if (selectedTab === DV_TAB_CONTACT_NOTE) {
            const data = { projectId: project.id, userId: objectId }
            URLsContacts.push(URL_CONTACT_DETAILS_NOTE, data, project.id, objectId)
        } else if (selectedTab === DV_TAB_CHAT_NOTE) {
            const data = { projectId: project.id, chatId: objectId }
            URLsChats.push(URL_CHAT_DETAILS_NOTE, data, project.id, objectId)
        } else if (selectedTab === DV_TAB_SKILL_NOTE) {
            const data = { projectId: project.id, skill: objectId }
            URLsSkills.push(URL_SKILL_DETAILS_NOTE, data, project.id, objectId)
        } else if (selectedTab === DV_TAB_ASSISTANT_NOTE) {
            const data = { projectId: project.id, assistantId: objectId }
            URLsAssistants.push(URL_ASSISTANT_DETAILS_NOTE, data, project.id, objectId)
        }
    }

    const onCreate = () => {
        setIsCreating(true)
        createNoteInObject(project.id, objectId, creatorId, objectName, objectType, objectPrivacy, setNote).then(() => {
            setIsCreating(false)
        })
    }

    return (
        <View style={{ marginHorizontal: mobile || mobileCollapsed ? 0 : isMiddleScreen ? -56 : -104, flex: 1 }}>
            <LoadingNoteData />
            {!noteId && !note ? (
                <View style={localStyles.container}>
                    <Text style={localStyles.title}>
                        {translate("This Object hasn't any note yet", { object: translate(objectType.slice(0, -1)) })}
                    </Text>
                    {!hideCreateNoteSection && (
                        <>
                            <Text style={localStyles.subTitle}>
                                {translate("This Object hasn't any note yet description", {
                                    object: translate(objectType.slice(0, -1)),
                                })}
                            </Text>
                            <Button
                                title={translate(accessGranted ? 'Start new note' : 'Login to start new note')}
                                type={accessGranted ? 'primary' : 'secondary'}
                                icon={!isCreating && 'file-text'}
                                onPress={onCreate}
                                shortcutText={'Enter'}
                                buttonStyle={{ alignSelf: 'center', opacity: isCreating ? 0.5 : 1, marginTop: 16 }}
                                disabled={isCreating || !accessGranted}
                                processing={isCreating}
                                processingTitle={`${translate('Creating Note')}...`}
                            />
                        </>
                    )}
                </View>
            ) : (
                note && (
                    <NoteEditorContainer
                        project={project}
                        note={note}
                        isFullscreen={isFullscreen}
                        setFullscreen={setFullscreen}
                        followState={followState}
                        objectType={objectType}
                        object={object}
                        objectId={objectId}
                        autoStartTranscription={autoStartTranscription}
                    />
                )
            )}
            {showMentionPopup && (
                <WrapperMentionsModal
                    mentionText={mentionText}
                    selectItemToMention={selectItemToMention}
                    insertNormalMention={insertNormalMention}
                    projectId={project.id}
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
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        flex: 1,
        maxWidth: 630,
        alignSelf: 'center',
    },
    title: {
        ...styles.title4,
        color: colors.Text02,
        textAlign: 'center',
    },
    subTitle: {
        ...styles.body1,
        color: colors.Text02,
        marginTop: 32,
        textAlign: 'center',
    },
})

export default NoteIntegration
