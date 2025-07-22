import React, { Component } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import Button from '../UIControls/Button'
import Icon from '../Icon'
import PropTypes from 'prop-types'
import Backend from '../../utils/BackendBridge'
import { cloneDeep, findIndex, isEqual } from 'lodash'
import store from '../../redux/store'
import { colors } from '../styles/global'
import {
    resetFloatPopup,
    setActiveEditMode,
    setLastAddNewNoteDate,
    setPrevScreen,
    setSelectedNavItem,
    setSelectedNote,
    setSelectedSidebarTab,
    setTmpInputTextNote,
    showConfirmPopup,
    startLoadingData,
    unsetActiveEditMode,
} from '../../redux/actions'
import NavigationService from '../../utils/NavigationService'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import Hotkeys from 'react-hot-keys'
import { dismissAllPopups, execShortcutFn } from '../../utils/HelperFunctions'
import CustomTextInput3 from '../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../Feeds/CommentsTextInput/textInputHelper'
import { getDvNoteTabLink, getLinkedParentUrl } from '../../utils/LinkingHelper'
import { DV_TAB_NOTE_EDITOR, DV_TAB_ROOT_NOTES } from '../../utils/TabNavigationConstants'
import StickyButton from '../UIControls/StickyButton'
import PrivacyButton from '../UIComponents/FloatModals/PrivacyModal/PrivacyButton'
import { FEED_NOTE_OBJECT_TYPE, FEED_PUBLIC_FOR_ALL } from '../Feeds/Utils/FeedsConstants'
import HighlightButton from '../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import { CONFIRM_POPUP_TRIGGER_DELETE_NOTE } from '../UIComponents/ConfirmPopup'
import NoteMoreButton from '../UIComponents/FloatModals/MorePopupsOfEditModals/Notes/NoteMoreButton'
import URLTrigger from '../../URLSystem/URLTrigger'
import { translate } from '../../i18n/TranslationService'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    updateNoteHighlight,
    updateNoteMeta,
    updateNotePrivacy,
    updateNoteStickyData,
    uploadNewNote,
} from '../../utils/backends/Notes/notesFirestore'
import { updateChatTitleWithoutFeeds } from '../../utils/backends/Chats/chatsFirestore'

class EditNote extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        let note = this.props.note
        this.setInitialUserId(note)
        this.setInitialPrivacy(note)
        let clonedNote = cloneDeep(note)

        this.state = {
            loggedUser: storeState.loggedUser,
            currentUser: storeState.currentUser,
            smallScreen: storeState.smallScreen,
            smallScreenNavigation: storeState.smallScreenNavigation,
            taskViewToggleSection: storeState.taskViewToggleSection,
            note: note,
            tmpNote: clonedNote,
            noteChanged: false,
            mounted: false,
            showButtonSpace: true,
            actionBeforeSave: false,
            followUpDate: null,
            linkedParentNotesUrl: [],
            linkedParentTasksUrl: [],
            linkedParentContactsUrl: [],
            linkedParentProjectsUrl: [],
            linkedParentGoalsUrl: [],
            linkedParentSkillsUrl: [],
            linkedParentAssistantsUrl: [],
            initialLinkedTasksUrl: [],
            initialLinkedNotesUrl: [],
            initialLinkedContactsUrl: [],
            initialLinkedProjectsUrl: [],
            initialLinkedGoalsUrl: [],
            initialLinkedSkillsUrl: [],
            initialLinkedAssistantsUrl: [],
            mentions: [],
            mentionsModalActive: false,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.inputNote = React.createRef()
        this.initialMentions = this.getInitialMentions(this.props.note.extendedTitle || this.props.note.title)
    }

    componentDidMount() {
        const { tmpNote, loggedUser } = this.state
        const { formType, defaultDate, projectId } = this.props

        // Setting the current user to default task
        if (tmpNote.userId === '' || tmpNote.userId === undefined) {
            tmpNote.userId = loggedUser.uid
        }

        if (formType === 'new') {
            store.dispatch(setLastAddNewNoteDate({ projectId, date: defaultDate.valueOf() }))
        }

        this.setState({ tmpNote: tmpNote, mounted: true })
        store.dispatch([setActiveEditMode(), resetFloatPopup()])
        document.addEventListener('keydown', this.onKeyDown)
        dismissAllPopups()
    }

    componentWillUnmount() {
        store.dispatch(unsetActiveEditMode())
        document.removeEventListener('keydown', this.onKeyDown)
        this.state.unsubscribe()
    }

    updateState = () => {
        const storeState = store.getState()

        this.setState({
            loggedUser: storeState.loggedUser,
            currentUser: storeState.currentUser,
            smallScreen: storeState.smallScreen,
            smallScreenNavigation: storeState.smallScreenNavigation,
        })

        if (storeState.showGlobalSearchPopup) {
            this.state.unsubscribe()
            this.dismissEditMode()
        }
    }

    setInitialUserId = note => {
        const { formType } = this.props
        const { inBacklinksView, loggedUser } = store.getState()

        if (formType === 'new' && inBacklinksView) {
            note.userId = loggedUser.uid
        }
    }

    setInitialPrivacy = note => {
        const { formType } = this.props
        const { inBacklinksView, loggedUser, currentUser } = store.getState()

        if (formType === 'new') {
            note.isPublicFor = inBacklinksView
                ? [FEED_PUBLIC_FOR_ALL, loggedUser.uid]
                : [FEED_PUBLIC_FOR_ALL, currentUser.uid]
        }
    }

    getInitialMentions = title => {
        const { projectUsers } = store.getState()
        const { projectId } = this.props
        const users = projectUsers[projectId]
        const mentionIds = TasksHelper.getMentionIdsFromTitle(title)
        const mentions = []

        for (let mention of mentionIds) {
            const index = findIndex(users, ['uid', mention])
            if (index >= 0) {
                mentions.push(users[index])
            }
        }

        return mentions
    }

    /**
     * Update value given field name for a task
     *
     * @param field ['isPrivate', 'hasStar', 'title', 'stickyData']
     * @param value mixed
     */
    updateNoteField = (field, value) => {
        const { tmpNote, loggedUser, note } = this.state

        if (typeof value === 'string') {
            value = value.replace(/\r?\n|\r/g, '')
            tmpNote[field] = value.trim().length === 0 ? '' : value

            if (field === 'title') {
                tmpNote['extendedTitle'] = tmpNote[field]
                tmpNote['title'] = TasksHelper.getTaskNameWithoutMeta(tmpNote[field])
            }
        } else {
            if (field === 'isPrivate') {
                tmpNote.isPrivate = value.isPrivate
                tmpNote.isPublicFor = value.isPublicFor
            } else {
                tmpNote[field] = value
            }
        }

        if (!isEqual(note, tmpNote) && this.isValidNote(tmpNote)) {
            this.setState({ tmpNote: tmpNote, noteChanged: true })
        } else {
            this.setState({ noteChanged: false })
        }

        if (field !== 'name') {
            if (this.inputNote.current) this.inputNote.current.focus()
        }
    }

    /**
     * Validate task
     * @returns {boolean}
     */
    isValidNote = tmpNote => {
        return (this.props.formType === 'new' && tmpNote.title.trim().length > 0) || this.props.formType === 'edit'
    }

    /**
     * Update task data in Firebase
     */
    updateNote = (e, actionBeforeSave) => {
        if (e) e.preventDefault()

        const { note, tmpNote, noteChanged, loggedUser } = this.state
        const { formType, projectId, onSuccessAction, linkedParentObject } = this.props

        // removing trailing spaces
        tmpNote.title = tmpNote.title.trim()

        const loggedUserIsCreator = formType === 'new' || loggedUser.uid === note.creatorId
        const loggedUserCanUpdateObject =
            !tmpNote.linkedToTemplate &&
            (loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

        if (noteChanged && loggedUserCanUpdateObject) {
            if (formType === 'new') {
                // setting current info
                const now = Date.now()
                tmpNote.creatorId = loggedUser.uid
                tmpNote.userId = tmpNote.userId || loggedUser.uid
                tmpNote.created = now

                const noteToUpload = { ...tmpNote }
                store.dispatch(setTmpInputTextNote(''))
                uploadNewNote(projectId, noteToUpload, true)
                    .then(note => {
                        this.onSuccessUploadNewNote(note, actionBeforeSave, linkedParentObject)
                    })
                    .catch(this.dismissEditMode)

                this.resetEditMode()
            } else {
                if (tmpNote.title === '') {
                    this.askToDeleteNote()
                } else {
                    updateNoteMeta(projectId, tmpNote, note)
                    if (note.extendedTitle !== tmpNote.extendedTitle) {
                        updateChatTitleWithoutFeeds(projectId, note.id, tmpNote.extendedTitle)
                    }
                    this.trySetLinkedObjects(note)
                    if (onSuccessAction !== undefined) {
                        onSuccessAction()
                    } else {
                        this.dismissEditMode()
                    }
                }
            }
        } else {
            this.dismissEditMode()
            Keyboard.dismiss()
        }
    }

    askToDeleteNote = e => {
        if (e) e.preventDefault()
        Keyboard.dismiss()
        const { note } = this.state
        const { projectId } = this.props

        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_NOTE,
                object: {
                    note,
                    projectId,
                },
            })
        )
    }

    onSuccessUploadNewNote = async (note, actionBeforeSave, linkedParentObject) => {
        const { project, onSuccessAction } = this.props

        try {
            // First handle any success actions
            if (onSuccessAction !== undefined) {
                await onSuccessAction()
            }

            // Set linked objects
            await this.trySetLinkedObjects(note)

            // Handle linked parent object case
            if (linkedParentObject) {
                // Navigate to the new note created from the linked notes view
                store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_NOTES))
                NavigationService.navigate('Root')
            } else {
                // Dispatch all state updates in a single batch
                store.dispatch([
                    setSelectedNavItem(DV_TAB_NOTE_EDITOR),
                    setPrevScreen('NotesView'),
                    setSelectedNote(note),
                ])

                // Small delay to ensure state updates are processed
                await new Promise(resolve => setTimeout(resolve, 100))

                // Navigate to the new note
                NavigationService.navigate('NotesDetailedView', {
                    noteId: note.id,
                    projectId: project.id,
                })
            }

            if (actionBeforeSave) {
                this.setState({ actionBeforeSave: false })
            }
        } catch (error) {
            console.error('Error in onSuccessUploadNewNote:', error)
            // If navigation fails, try to navigate to root
            NavigationService.navigate('Root')
        }
    }

    trySetLinkedObjects = note => {
        const {
            linkedParentNotesUrl,
            linkedParentTasksUrl,
            linkedParentContactsUrl,
            linkedParentProjectsUrl,
            linkedParentGoalsUrl,
            linkedParentSkillsUrl,
            linkedParentAssistantsUrl,
            initialLinkedTasksUrl,
            initialLinkedNotesUrl,
            initialLinkedContactsUrl,
            initialLinkedProjectsUrl,
            initialLinkedGoalsUrl,
            initialLinkedSkillsUrl,
            initialLinkedAssistantsUrl,
        } = this.state
        const { projectId } = this.props
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

    resetEditMode = () => {
        // clean text input
        this.inputNote.current.clear()
        this.dismissEditMode()
    }

    dismissEditMode = () => {
        this.props.onCancelAction()
    }

    onKeyDown = event => {
        const { key } = event
        const { mentionsModalActive } = this.state
        const { showFloatPopup } = store.getState()

        if (key === 'Enter') {
            if (!mentionsModalActive && showFloatPopup === 0) {
                this.updateNote()
            }
        }
    }

    setMentions = mentions => {
        this.setState({ mentions })
    }

    setMentionsModalActive = mentionsModalActive => {
        this.setState({ mentionsModalActive })
    }

    setPrivacyBeforeSave = (isPrivate, isPublicFor) => {
        const { formType, projectId } = this.props
        const { tmpNote } = this.state
        if (formType === 'new') {
            const privacy = { isPrivate, isPublicFor }
            this.updateNoteField('isPrivate', privacy)
        } else {
            setTimeout(() => {
                this.dismissEditMode()
                updateNotePrivacy(projectId, tmpNote.id, isPrivate, isPublicFor, tmpNote.followersIds, false, tmpNote)
            }, 1500)
        }
    }

    setHighlightBeforeSave = color => {
        const { formType, projectId } = this.props
        const { tmpNote } = this.state
        if (formType === 'new') {
            this.updateNoteField('hasStar', color)
        } else {
            this.dismissEditMode()
            updateNoteHighlight(projectId, tmpNote.id, color)
        }
    }

    setStickyBeforeSave = stickyData => {
        const { formType, projectId } = this.props
        const { tmpNote } = this.state
        if (formType === 'new') {
            this.updateNoteField('stickyData', stickyData)
        } else {
            this.dismissEditMode()
            updateNoteStickyData(projectId, tmpNote.id, stickyData)
        }
    }

    onOpenDetailedView = () => {
        const { note, project, formType } = this.props
        let noteId = note.id
        if (noteId === undefined || formType === 'new') {
            this.setState({ actionBeforeSave: true })
            this.updateNote(null, true)
        } else {
            this.dismissEditMode()
            if (note.parentObject) {
                store.dispatch(startLoadingData())

                const url = getDvNoteTabLink(
                    project.id,
                    note.parentObject.id,
                    note.parentObject.type === 'topics' ? 'chats' : note.parentObject.type
                )
                URLTrigger.processUrl(NavigationService, url)
            } else {
                store.dispatch([
                    setSelectedNavItem(DV_TAB_NOTE_EDITOR),
                    setPrevScreen('NotesView'),
                    setSelectedNote(note),
                ])
                NavigationService.navigate('NotesDetailedView', {
                    noteId: note.id,
                    projectId: project.id,
                })
            }
        }
    }

    getPlaceholderText = formType => {
        if (formType === 'new') {
            return 'Type note title to add new note'
        }
        return 'Write the title of the note'
    }

    onChangeInputText = (
        text,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        if (text !== '') {
            this.setState({
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            })
        }
        this.updateNoteField('title', text.replace(/\r?\n|\r/g, ''))
        if (this.props.formType === 'new') {
            store.dispatch(setTmpInputTextNote(text))
        }
    }

    onContainerLayout = event => {
        this.setState({ showButtonSpace: event.nativeEvent.layout.width > 915 })
    }

    getInitialText = () => {
        const { tmpNote, actionBeforeSave } = this.state
        const { linkedParentObject, project, formType } = this.props
        let initialText = tmpNote?.extendedTitle !== '' ? tmpNote.extendedTitle : tmpNote.title
        if (
            tmpNote?.title != null &&
            tmpNote?.extendedTitle != null &&
            !actionBeforeSave &&
            linkedParentObject &&
            formType === 'new'
        ) {
            initialText = `${getLinkedParentUrl(project.id, linkedParentObject)}`
        } else if (formType === 'new') {
            return store.getState().tmpInputTextNote
        }
        const mentionRegExp = /@\S*$/
        const parts = initialText.split(' ')
        const mentionMatch = parts[parts.length - 1].match(mentionRegExp)
        return `${initialText}${mentionMatch ? '  ' : ' '}`
    }

    setInitialLinkedObject = (
        initialLinkedTasksUrl,
        initialLinkedNotesUrl,
        initialLinkedContactsUrl,
        initialLinkedProjectsUrl,
        initialLinkedGoalsUrl,
        initialLinkedSkillsUrl,
        initialLinkedAssistantsUrl
    ) => {
        this.setState({
            initialLinkedNotesUrl,
            initialLinkedTasksUrl,
            initialLinkedContactsUrl,
            initialLinkedProjectsUrl,
            initialLinkedGoalsUrl,
            initialLinkedSkillsUrl,
            initialLinkedAssistantsUrl,
        })
    }

    render() {
        const { tmpNote, noteChanged, smallScreen, smallScreenNavigation, showButtonSpace, loggedUser } = this.state
        const { note, formType, style, projectId } = this.props
        const buttonItemStyle = { marginRight: smallScreen ? 8 : 4 }

        const loggedUserIsCreator = formType === 'new' || loggedUser.uid === note.creatorId
        const loggedUserCanUpdateObject =
            !tmpNote.linkedToTemplate &&
            (loggedUserIsCreator || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId))

        return (
            <View
                onLayout={this.onContainerLayout}
                style={[
                    localStyles.container,
                    smallScreenNavigation ? localStyles.containerUnderBreakpoint : undefined,
                    style,
                ]}
                data-edit-note={`${note.id}`}
            >
                <View style={localStyles.inputContainer}>
                    <View
                        style={[
                            localStyles.icon,
                            formType === 'new' ? localStyles.iconNew : undefined,
                            formType === 'new' && smallScreenNavigation ? localStyles.iconNewMobile : undefined,
                        ]}
                    >
                        <Icon
                            name={formType === 'new' ? 'plus-square' : 'file-text'}
                            size={24}
                            color={colors.Primary100}
                        />
                    </View>

                    <CustomTextInput3
                        ref={this.inputNote}
                        placeholder={translate(this.getPlaceholderText(formType))}
                        placeholderTextColor={colors.Text03}
                        onChangeText={this.onChangeInputText}
                        autoFocus={true}
                        updateMentions={this.setMentions}
                        setMentionsModalActive={this.setMentionsModalActive}
                        projectId={projectId}
                        externalAlignment={localStyles.textInputAlignment}
                        containerStyle={[
                            localStyles.textInputContainer,
                            smallScreenNavigation ? localStyles.inputUnderBreakpoint : undefined,
                        ]}
                        initialTextExtended={this.getInitialText()}
                        initialMentions={this.initialMentions}
                        styleTheme={TASK_THEME}
                        setInitialLinkedObject={formType === 'edit' ? this.setInitialLinkedObject : null}
                        disabledEdition={!!note.parentObject || !loggedUserCanUpdateObject}
                        forceTriggerEnterActionForBreakLines={this.updateNote}
                    />
                </View>
                <View style={localStyles.buttonContainer}>
                    <View style={[localStyles.buttonSection]}>
                        <View style={{ marginRight: smallScreenNavigation || !showButtonSpace ? 4 : 32 }}>
                            <Hotkeys
                                keyName={'alt+O'}
                                disabled={formType === 'new' && !noteChanged}
                                onKeyDown={(sht, event) =>
                                    execShortcutFn(this.openBtnRef, () => this.onOpenDetailedView(), event)
                                }
                                filter={e => true}
                            >
                                <Button
                                    ref={ref => (this.openBtnRef = ref)}
                                    title={smallScreen ? null : translate('Open nav')}
                                    type={'secondary'}
                                    noBorder={smallScreen}
                                    icon={'maximize-2'}
                                    buttonStyle={buttonItemStyle}
                                    onPress={() => this.onOpenDetailedView()}
                                    disabled={formType === 'new' && !noteChanged}
                                    shortcutText={'O'}
                                />
                            </Hotkeys>
                        </View>

                        {loggedUserCanUpdateObject && (
                            <PrivacyButton
                                projectId={projectId}
                                object={tmpNote}
                                objectType={FEED_NOTE_OBJECT_TYPE}
                                disabled={(formType === 'new' && !noteChanged) || !!note.parentObject}
                                savePrivacyBeforeSaveObject={this.setPrivacyBeforeSave}
                                inEditComponent={true}
                                style={buttonItemStyle}
                                shortcutText={'P'}
                            />
                        )}

                        {loggedUserCanUpdateObject && (
                            <HighlightButton
                                projectId={projectId}
                                object={tmpNote}
                                objectType={FEED_NOTE_OBJECT_TYPE}
                                disabled={formType === 'new' && !noteChanged}
                                saveHighlightBeforeSaveObject={this.setHighlightBeforeSave}
                                inEditComponent={true}
                                style={buttonItemStyle}
                                shortcutText={'H'}
                            />
                        )}

                        {loggedUserCanUpdateObject && (
                            <StickyButton
                                projectId={projectId}
                                note={tmpNote}
                                disabled={formType === 'new' && !noteChanged}
                                style={buttonItemStyle}
                                shortcutText={'Y'}
                                saveStickyBeforeSaveNote={this.setStickyBeforeSave}
                            />
                        )}

                        {formType === 'edit' && loggedUserCanUpdateObject && (
                            <NoteMoreButton
                                formType={formType}
                                projectId={projectId}
                                note={tmpNote}
                                buttonStyle={buttonItemStyle}
                                dismissEditMode={this.dismissEditMode}
                                disabled={formType === 'new' && !noteChanged}
                            />
                        )}
                    </View>

                    <View style={[localStyles.buttonSection, localStyles.buttonSectionRight]}>
                        {smallScreen ? undefined : (
                            <Button
                                title={translate('Cancel')}
                                type={'secondary'}
                                buttonStyle={buttonItemStyle}
                                onPress={this.dismissEditMode}
                                shortcutText={'Esc'}
                            />
                        )}

                        <Button
                            title={
                                smallScreen
                                    ? null
                                    : translate(
                                          !noteChanged
                                              ? 'Ok'
                                              : formType === 'new'
                                              ? `Add`
                                              : formType === 'edit' && tmpNote.title === ''
                                              ? `Delete`
                                              : `Save`
                                      )
                            }
                            type={formType === 'edit' && tmpNote.title === '' ? 'danger' : 'primary'}
                            icon={
                                smallScreen
                                    ? formType === 'edit' && tmpNote.title === ''
                                        ? 'trash-2'
                                        : !noteChanged
                                        ? 'x'
                                        : formType === 'new'
                                        ? 'plus'
                                        : 'save'
                                    : null
                            }
                            onPress={this.updateNote}
                            accessible={false}
                            shortcutText={'Enter'}
                        />
                    </View>
                </View>
            </View>
        )
    }
}

EditNote.propTypes = {
    formType: PropTypes.oneOf(['new', 'edit']),
    note: PropTypes.object.isRequired,
    projectId: PropTypes.string.isRequired,
    onCancelAction: PropTypes.func.isRequired,
    onSuccessAction: PropTypes.func,
    editModeCheckOff: PropTypes.func,
    defaultDate: PropTypes.oneOfType([PropTypes.number, PropTypes.instanceOf(Date)]),
    style: PropTypes.object,
}

EditNote.defaultProps = {
    note: TasksHelper.getNewDefaultNote(),
    formType: 'new',
    style: {},
    defaultDate: Date.now(),
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
        elevation: 3,
        marginLeft: -16,
        marginRight: -16,
        marginBottom: 16,
    },
    containerUnderBreakpoint: {
        marginLeft: -8,
        marginRight: -8,
    },
    assigneeButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        borderRadius: 50,
        overflow: 'hidden',
    },
    buttonContainer: {
        flex: 1,
        height: 55,
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: colors.Grey100,
        borderTopWidth: 1,
        borderStyle: 'solid',
        borderTopColor: colors.Gray300,
        paddingVertical: 7,
        paddingHorizontal: 9,
    },
    buttonSection: {
        flexDirection: 'row',
    },
    buttonSectionRight: {
        justifyContent: 'flex-end',
    },
    inputContainer: {
        minHeight: 59, // (+1 border top = 60)
        overflow: 'hidden',
    },
    icon: {
        position: 'absolute',
        padding: 0,
        margin: 0,
        left: 15,
        top: 7,
    },
    iconNew: {
        top: 7,
    },
    iconNewMobile: {
        top: 7,
        left: 7,
    },

    // Text Input ===========================================
    textInputContainer: {
        marginTop: 2,
        marginBottom: 12,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 40, // 59 - (7 + 12)
        marginLeft: 51,
        marginRight: 40,
    },
    textInputAlignment: {
        paddingLeft: 0,
        paddingRight: 0,
    },
    textInputUnderBreakpoint: {
        paddingRight: 0,
    },
    inputUnderBreakpoint: {
        marginLeft: 44,
        marginRight: 32,
    },
})

const subTaskStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Grey200,
    },
    inputContainer: {
        minHeight: 55,
        overflow: 'hidden',
    },
    textInputContainer: {
        marginBottom: 8,
        minHeight: 40, // 55 - (7 + 12)
    },
    icon: {
        left: 19,
        top: 9,
    },
    iconMobile: {
        left: 11,
        top: 9,
    },
    iconNew: {
        left: 17,
        top: 7,
    },
    iconNewMobile: {
        left: 9,
        top: 7,
    },
    subtaskIndicatorMobile: {
        position: 'absolute',
        top: 7,
        left: 8,
        zIndex: 10,
    },
})

export default EditNote
