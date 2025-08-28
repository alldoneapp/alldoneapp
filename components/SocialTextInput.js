import React, { Component } from 'react'
import SocialText from './UIControls/SocialText/SocialText'
import store from '../redux/store'
import { setTaskTitleInEditMode, showConfirmPopup } from '../redux/actions'
import CustomTextInput3 from './Feeds/CommentsTextInput/CustomTextInput3'
import { colors } from './styles/global'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import ProjectHelper from './SettingsView/ProjectsSettings/ProjectHelper'
import Icon from './Icon'
import { CONFIRM_POPUP_TRIGGER_DELETE_TASK } from './UIComponents/ConfirmPopup'
import { findIndex } from 'lodash'
import Hotkeys from 'react-hot-keys'
import MyPlatform from './MyPlatform'
import TasksHelper from './TaskListView/Utils/TasksHelper'
import { TITLE_NOTE, TITLE_TASK } from './TaskDetailedView/Header/TaskTitle'
import SharedHelper from '../utils/SharedHelper'
import { DV_TAB_ROOT_TASKS } from '../utils/TabNavigationConstants'
import Backend from '../utils/BackendBridge'
import { exitsOpenModals } from './ModalsManager/modalsManager'
import { Dismissible } from 'react-dismissible'

class SocialTextInput extends Component {
    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            text: this.props.value || '',
            originalText: this.props.value || '',
            inputFocus: storeState.taskTitleInEditMode,
            loggedUser: storeState.loggedUser,
            inputWidth: 0,
            mounted: false,
            mentions: [],
            mentionsModalActive: false,
            linkedParentNotesUrl: [],
            linkedParentTasksUrl: [],
            linkedParentContactsUrl: [],
            linkedParentProjectsUrl: [],
            linkedParentGoalsUrl: [],
            linkedParentSkillsUrl: [],
            linkedParentAssistantsUrl: [],
            unsubscribe: store.subscribe(this.updateState),
        }

        this.inputText = React.createRef()
        this.initialMentions =
            this.props.titleType === TITLE_NOTE ? [] : this.getInitialMentions(this.props.value || '')
        this.mainContainer = React.createRef()
        this.buttonsContainer = React.createRef()
    }

    componentDidMount() {
        this.setState({ mounted: true })
        store.dispatch(setTaskTitleInEditMode(false))
    }

    componentDidUpdate(prevProps, prevState) {
        const { projectId, titleType, objectId } = this.props

        if (projectId !== prevProps.projectId || titleType !== prevProps.titleType || objectId !== prevProps.objectId) {
            store.dispatch(setTaskTitleInEditMode(false))
        }
    }

    componentWillUnmount() {
        store.dispatch(setTaskTitleInEditMode(false))
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

    setMentionsModalActive = mentionsModalActive => {
        this.setState({ mentionsModalActive })
    }

    setMentions = mentions => {
        this.setState({ mentions })
    }

    focus = () => {
        if (this.inputText && !this.inputText.current?.isFocused()) {
            this.inputText.current.focus()
            if (this.props.onFocus) this.props.onFocus()
        }
    }

    deleteTask = () => {
        store.dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_DELETE_TASK,
                object: {
                    task: this.props.task,
                    projectId: this.props.projectId,
                    navigation: DV_TAB_ROOT_TASKS,
                    originalTaskName: this.props.task.name,
                },
            })
        )
    }

    submitEditing = () => {
        const { text, originalText } = this.state
        const { onSubmitEditing } = this.props

        if (onSubmitEditing !== undefined && text.trim() !== '') {
            this.setState({ originalText: text.trim() })
            onSubmitEditing(text.trim())
        } else {
            this.setState({ text: originalText })
        }
        store.dispatch(setTaskTitleInEditMode(false))
    }

    saveChanges = () => {
        if (store.getState().showFloatPopup > 0) return

        if (this.state.text === '') {
            this.deleteTask()
        } else {
            this.submitEditing()
            this.trySetLinkedObjects()
        }
    }

    updateInputWidth = async () => {
        if (this.mainContainer) {
            const containerWidth = await MyPlatform.getElementWidth(this.mainContainer.current)
            const buttonsContainerWidth = await MyPlatform.getElementWidth(this.buttonsContainer.current)
            // 36 is the amount for horizontal padding and border
            this.setState({ inputWidth: containerWidth - buttonsContainerWidth - 36 })
        }
    }

    onChangeText = (
        text,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        const { titleType } = this.props
        if (text !== '' && (titleType === TITLE_NOTE || titleType === TITLE_TASK)) {
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
        this.setState({ text: text })
    }

    trySetLinkedObjects = () => {
        const { disableBacklinksGeneration } = this.props
        if (!disableBacklinksGeneration) {
            const {
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            } = this.state
            const { projectId, titleType, objectId, object } = this.props

            if (titleType === TITLE_NOTE || titleType === TITLE_TASK) {
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
                    titleType === TITLE_NOTE
                        ? {
                              type: 'note',
                              id: objectId,
                              secondaryParentsIds: object.linkedParentsInContentIds,
                              notePartEdited: 'title',
                              isUpdatingNotes: true,
                          }
                        : { type: 'task', id: objectId },
                    {}
                )
            }
        }
    }

    cancelEditForm = () => {
        const { originalText } = this.state
        store.dispatch(setTaskTitleInEditMode(false))
        this.setState({ text: originalText })
    }

    render() {
        const { text, originalText, inputFocus, inputWidth, loggedUser } = this.state
        const {
            projectId,
            task,
            hashtagStyle,
            mentionStyle,
            emailStyle,
            linkStyle,
            normalStyle,
            inTaskDetailedView,
            numberOfLines,
            titleType,
            disabled,
            disabledMentions,
        } = this.props
        const initialState = text.length === 0 && !inputFocus && !task.genericData
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

        return inputFocus || initialState ? (
            <View ref={this.mainContainer} style={{ flexDirection: 'row' }} onLayout={this.updateInputWidth}>
                <View style={[{ flex: 1 }, localStyles.textInputFocused]}>
                    <Dismissible
                        disabled={exitsOpenModals()}
                        click={true}
                        escape={true}
                        onDismiss={this.cancelEditForm}
                    >
                        <CustomTextInput3
                            ref={this.inputText}
                            onChangeText={this.onChangeText}
                            autoFocus={true}
                            updateMentions={this.setMentions}
                            setMentionsModalActive={this.setMentionsModalActive}
                            projectId={projectId}
                            projectIndex={ProjectHelper.getProjectIndexById(projectId)}
                            containerStyle={[localStyles.textInputAlignment, { minWidth: inputWidth }]}
                            initialTextExtended={`${text} `}
                            initialMentions={this.initialMentions}
                            horizontalScroll={true}
                            placeholder="Write the name of the task"
                            maxHeight={titleType === TITLE_NOTE ? 315 : undefined}
                            disabledMentions={disabledMentions}
                            forceTriggerEnterActionForBreakLines={this.saveChanges}
                        />
                    </Dismissible>
                </View>

                {inputFocus ? (
                    <View ref={this.buttonsContainer} style={{ flexDirection: 'row' }}>
                        <TouchableOpacity onPress={this.cancelEditForm} style={localStyles.buttonX}>
                            <Icon name="x" size={24} color={colors.Text02} />
                        </TouchableOpacity>

                        <Hotkeys keyName={'enter'} onKeyDown={this.saveChanges} filter={e => true}>
                            <TouchableOpacity
                                onPress={this.saveChanges}
                                style={[
                                    localStyles.buttonSave,
                                    originalText !== text && localStyles.buttonSaveActive,
                                    text === '' ? localStyles.buttonSaveDelete : undefined,
                                ]}
                                accessible={false}
                            >
                                <Icon name={text === '' ? 'trash-2' : 'save'} size={24} color="white" />
                            </TouchableOpacity>
                        </Hotkeys>
                    </View>
                ) : null}
            </View>
        ) : (
            <SocialText
                hashtagStyle={hashtagStyle}
                mentionStyle={mentionStyle}
                emailStyle={emailStyle}
                linkStyle={linkStyle}
                normalStyle={normalStyle}
                hasLinkBack={task.linkBack !== undefined && task.linkBack.length > 0}
                task={task}
                onPress={() => {
                    if (!task.calendarData && !task.gmailData) {
                        store.dispatch(setTaskTitleInEditMode(!(task.genericData || !accessGranted || disabled)))
                    }
                }}
                inTaskDetailedView={inTaskDetailedView}
                projectId={projectId}
                wrapText={true}
                numberOfLines={numberOfLines}
            >
                {text}
            </SocialText>
        )
    }

    updateState = () => {
        const storeState = store.getState()
        this.setState({
            inputFocus: storeState.taskTitleInEditMode,
            loggedUser: storeState.loggedUser,
        })

        if (storeState.showGlobalSearchPopup && storeState.taskTitleInEditMode) {
            this.cancelEditForm()
        }
    }
}

SocialTextInput.defaultProps = {
    titleType: TITLE_TASK,
}

export default SocialTextInput

const localStyles = StyleSheet.create({
    textInputFocused: {
        borderWidth: 2,
        borderColor: colors.UtilityBlue200,
        borderRadius: 4,
        minHeight: 40,
        paddingHorizontal: 16,
    },
    buttonX: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EAF0F5',
        width: 48,
        height: 40,
        marginLeft: 8,
        borderRadius: 4,
    },
    buttonSaveDelete: {
        backgroundColor: colors.Red200,
    },
    buttonSaveActive: {
        opacity: 1,
    },
    buttonSave: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Primary300,
        width: 48,
        height: 40,
        marginLeft: 8,
        borderRadius: 4,
        opacity: 0.5,
    },
    textInputAlignment: {
        paddingLeft: 0,
        paddingRight: 0,
        height: 24,
    },
})
