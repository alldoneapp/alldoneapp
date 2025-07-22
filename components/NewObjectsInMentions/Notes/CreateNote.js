import React, { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import Backend from '../../../utils/BackendBridge'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { StyleSheet, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME, MENTION_MODAL_NOTES_TAB } from '../../Feeds/CommentsTextInput/textInputHelper'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_NOTE_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import StickyWrapper from './StickyWrapper'
import PlusButton from '../Common/PlusButton'
import { setSelectedNavItem, startLoadingData, stopLoadingData } from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../../../i18n/TranslationService'
import store from '../../../redux/store'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import { DV_TAB_NOTE_EDITOR } from '../../../utils/TabNavigationConstants'
import { uploadNewNote } from '../../../utils/backends/Notes/notesFirestore'

export default function CreateNote({ projectId, containerStyle, selectItemToMention, modalId, mentionText }) {
    const dispatch = useDispatch()
    const [sendingData, setSendingData] = useState(false)
    const [note, setNote] = useState(TasksHelper.getNewDefaultNote())
    const [linkedParentNotesUrl, setLinkedParentNotesUrl] = useState([])
    const [linkedParentTasksUrl, setLinkedParentTasksUrl] = useState([])
    const [linkedParentContactsUrl, setLinkedParentContactsUrl] = useState([])
    const [linkedParentProjectsUrl, setLinkedParentProjectsUrl] = useState([])
    const [linkedParentGoalsUrl, setLinkedParentGoalsUrl] = useState([])
    const [linkedParentSkillsUrl, setLinkedParentSkillsUrl] = useState([])
    const [linkedParentAssistantsUrl, setLinkedParentAssistantsUrl] = useState([])
    const inputText = useRef()

    const cleanedTitle = note?.extendedTitle?.trim()

    useEffect(() => {
        inputText?.current?.focus()
    }, [])

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
        // setNote(note => ({ ...note, isPrivate, isPublicFor }))
        addNote(false, { ...note, isPrivate, isPublicFor })
    }

    const setColor = color => {
        // setNote(note => ({ ...note, hasStar: color }))
        addNote(false, { ...note, hasStar: color })
    }

    const setStickyData = stickyData => {
        // setNote(note => ({ ...note, stickyData }))
        addNote(false, { ...note, stickyData })
    }

    const addNote = async (openDetails = false, directNote = null) => {
        const newNote = directNote || { ...note }
        newNote.extendedTitle = note.extendedTitle.trim()
        newNote.title = TasksHelper.getTaskNameWithoutMeta(newNote.extendedTitle)

        if (newNote.extendedTitle.length > 0) {
            dispatch(startLoadingData())
            setSendingData(true)

            uploadNewNote(projectId, newNote, true).then(noteDB => {
                trySetLinkedObjects(noteDB)

                dispatch(stopLoadingData())
                setSendingData(false)

                if (selectItemToMention) {
                    selectItemToMention(noteDB, MENTION_MODAL_NOTES_TAB, projectId)
                }

                if (openDetails) {
                    NavigationService.navigate('NotesDetailedView', {
                        noteId: noteDB.id,
                        projectId,
                    })
                    store.dispatch(setSelectedNavItem(DV_TAB_NOTE_EDITOR))
                }
            })
        }
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
            { type: 'note', id: note.id }
        )
    }

    const enterKeyAction = () => {
        const { mentionModalStack } = store.getState()
        if (
            mentionModalStack[0] === modalId &&
            !exitsOpenModals([MENTION_MODAL_ID, COMMENT_MODAL_ID, TAGS_INTERACTION_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID])
        ) {
            addNote()
        }
    }

    return !note ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={translate('Type to add note')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={mentionText || note.extendedName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        disabledEdition={sendingData}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    {/*<OpenButton onPress={open} disabled={!cleanedTitle || sendingData} />*/}

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
                </View>
                <View style={localStyles.buttonsRight}>
                    <PlusButton onPress={() => addNote()} disabled={!cleanedTitle || sendingData} modalId={modalId} />
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
