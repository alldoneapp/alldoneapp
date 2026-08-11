import React, { useRef, useState, useEffect } from 'react'
import NavigationService from '../../../utils/NavigationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { StyleSheet, View } from 'react-native'
import Icon from '../../Icon'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import styles, { colors } from '../../styles/global'
import { CREATE_TASK_MODAL_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import OpenButton from '../../NewObjectsInMentions/Common/OpenButton'
import SaveButton from '../Common/SaveButton'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import {
    setPrevScreen,
    setSelectedNavItem,
    setSelectedNote,
    setSelectedTypeOfProject,
    startLoadingData,
    stopLoadingData,
    storeCurrentUser,
    switchProject,
} from '../../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import Backend from '../../../utils/BackendBridge'
import store from '../../../redux/store'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_NOTE_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import StickyWrapper from '../../NewObjectsInMentions/Notes/StickyWrapper'
import NoteMoreButton from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Notes/NoteMoreButton'
import { FORM_TYPE_EDIT } from '../../NotesView/NotesDV/EditorView/EditorsGroup/EditorsConstants'
import { DV_TAB_NOTE_EDITOR } from '../../../utils/TabNavigationConstants'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'
import URLTrigger from '../../../URLSystem/URLTrigger'
import {
    updateNoteHighlight,
    updateNoteMeta,
    updateNotePrivacy,
    updateNoteStickyData,
} from '../../../utils/backends/Notes/notesFirestore'

export default function EditNoteLink({ projectId, containerStyle, noteData, closeModal, objectUrl }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [sendingData, setSendingData] = useState(false)
    const [note, setNote] = useState(Backend.mapNoteData(noteData.id, noteData))
    const [linkedParentNotesUrl, setLinkedParentNotesUrl] = useState([])
    const [linkedParentTasksUrl, setLinkedParentTasksUrl] = useState([])
    const [linkedParentContactsUrl, setLinkedParentContactsUrl] = useState([])
    const [linkedParentProjectsUrl, setLinkedParentProjectsUrl] = useState([])
    const [linkedParentGoalsUrl, setLinkedParentGoalsUrl] = useState([])
    const [linkedParentSkillsUrl, setLinkedParentSkillsUrl] = useState([])
    const [linkedParentAssistantsUrl, setLinkedParentAssistantsUrl] = useState([])

    const [initialLinkedNotesUrl, setInitialLinkedNotesUrl] = useState([])
    const [initialLinkedTasksUrl, setInitialLinkedTasksUrl] = useState([])
    const [initialLinkedContactsUrl, setInitialLinkedContactsUrl] = useState([])
    const [initialLinkedProjectsUrl, setInitialLinkedProjectsUrl] = useState([])
    const [initialLinkedGoalsUrl, setInitialLinkedGoalsUrl] = useState([])
    const [initialLinkedSkillsUrl, setInitialLinkedSkillsUrl] = useState([])
    const [initialLinkedAssistantsUrl, setInitialLinkedAssistantsUrl] = useState([])
    const project = ProjectHelper.getProjectById(projectId)
    const inputText = useRef()

    const cleanedTitle = note.extendedTitle.trim()

    const needBeUpdated = () => {
        return note.extendedTitle.trim() !== noteData.extendedTitle.trim()
    }

    const setInitialLinkedObject = (
        initialLinkedTasksUrl,
        initialLinkedNotesUrl,
        initialLinkedContactsUrl,
        initialLinkedProjectsUrl,
        initialLinkedGoalsUrl,
        initialLinkedSkillsUrl,
        initialLinkedAssistantsUrl
    ) => {
        setInitialLinkedNotesUrl(initialLinkedTasksUrl)
        setInitialLinkedTasksUrl(initialLinkedNotesUrl)
        setInitialLinkedContactsUrl(initialLinkedContactsUrl)
        setInitialLinkedProjectsUrl(initialLinkedProjectsUrl)
        setInitialLinkedGoalsUrl(initialLinkedGoalsUrl)
        setInitialLinkedSkillsUrl(initialLinkedSkillsUrl)
        setInitialLinkedAssistantsUrl(initialLinkedAssistantsUrl)
    }

    const trySetLinkedObjects = note => {
        Backend.setLinkedParentObjects(
            projectId,
            {
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            },
            {
                type: 'note',
                id: note.id,
                secondaryParentsIds: note.linkedParentsInContentIds,
                notePartEdited: 'title',
            },
            {
                initialLinkedTasksUrl,
                initialLinkedNotesUrl,
                initialLinkedContactsUrl,
                initialLinkedProjectsUrl,
                initialLinkedGoalsUrl,
                initialLinkedSkillsUrl,
                initialLinkedAssistantsUrl,
            }
        )
    }

    const onChangeText = (
        extendedTitle,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        if (extendedTitle !== '') {
            setLinkedParentNotesUrl(linkedParentNotesUrl)
            setLinkedParentTasksUrl(linkedParentTasksUrl)
            setLinkedParentContactsUrl(linkedParentContactsUrl)
            setLinkedParentProjectsUrl(linkedParentProjectsUrl)
            setLinkedParentGoalsUrl(linkedParentGoalsUrl)
            setLinkedParentSkillsUrl(linkedParentSkillsUrl)
            setLinkedParentAssistantsUrl(linkedParentAssistantsUrl)
        }
        setNote(note => ({ ...note, extendedTitle }))
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        updateNotePrivacy(projectId, note.id, isPrivate, isPublicFor, note.followersIds, false, note)
        closeModal()
    }

    const setColor = color => {
        updateNoteHighlight(projectId, note.id, color)
        closeModal()
    }

    const setStickyData = stickyData => {
        updateNoteStickyData(projectId, note.id, stickyData)
        closeModal()
    }

    const updateNote = (openDetails = false, directNote = null) => {
        const updatedNote = directNote || { ...note }
        updatedNote.extendedTitle = note.extendedTitle.trim()
        updatedNote.title = TasksHelper.getTaskNameWithoutMeta(updatedNote.extendedTitle)

        if (updatedNote.extendedTitle.length > 0) {
            dispatch(startLoadingData())
            setSendingData(true)

            updateNoteMeta(projectId, updatedNote, note)
            trySetLinkedObjects(note)

            dispatch(stopLoadingData())
            setSendingData(false)

            if (openDetails) {
                openDV()
            } else {
                closeModal()
            }
        }
    }

    const openDV = () => {
        const { loggedUser } = store.getState()
        closeModal()
        dispatch([
            setSelectedNavItem(DV_TAB_NOTE_EDITOR),
            setPrevScreen('NotesView'),
            setSelectedNote(note),
            switchProject(project.index),
            storeCurrentUser(loggedUser),
            setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
        ])
        NavigationService.navigate('NotesDetailedView', {
            projectId: project.id,
            noteId: note.id,
        })
    }

    const enterKeyAction = () => {
        if (!exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            needBeUpdated() ? updateNote() : closeModal()
        }
    }

    useEffect(() => {
        const loggedUserIsCreator = loggedUserId === note.creatorId
        const loggedUserCanUpdateObject =
            !note.linkedToTemplate &&
            (loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

        if (!loggedUserCanUpdateObject) {
            closeModal()
            const url = `/projects/${projectId}/notes/${note.id}/properties`
            URLTrigger.processUrl(NavigationService, url)
        }
    }, [])

    return !note ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'file-text'} size={24} color={'#ffffff'} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={'Type to edit the note'}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={note.extendedTitle}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        disabledEdition={sendingData}
                        setInitialLinkedObject={setInitialLinkedObject}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    <OpenButton
                        onPress={needBeUpdated() ? () => updateNote(true) : openDV}
                        disabled={!cleanedTitle || sendingData}
                    />

                    <PrivacyWrapper
                        object={note}
                        objectType={FEED_NOTE_OBJECT_TYPE}
                        projectId={projectId}
                        setPrivacy={setPrivacy}
                        disabled={!cleanedTitle || sendingData}
                    />

                    <HighlightWrapper object={note} setColor={setColor} disabled={!cleanedTitle || sendingData} />

                    <StickyWrapper
                        note={note}
                        projectId={projectId}
                        disabled={!cleanedTitle || sendingData}
                        setSticky={setStickyData}
                    />

                    <NoteMoreButton
                        projectId={projectId}
                        formType={FORM_TYPE_EDIT}
                        note={note}
                        buttonStyle={{ marginRight: 4 }}
                        dismissEditMode={() => closeModal()}
                        disabled={!cleanedTitle || sendingData}
                        inMentionModal={true}
                    />
                </View>
                <View style={localStyles.buttonsRight}>
                    <SaveButton
                        icon={(!needBeUpdated() || !cleanedTitle || sendingData) && 'x'}
                        onPress={needBeUpdated() ? () => updateNote() : closeModal}
                        disabled={sendingData}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    buttonsRight: {},
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
})
