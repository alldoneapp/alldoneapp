import React, { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { NOT_ALLOW_EDIT_TAGS, SUBTASK_THEME, TASK_THEME } from '../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../i18n/TranslationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function TaskInput({
    isSubtask,
    tmpTask,
    adding,
    projectId,
    accessGranted,
    loggedUserCanUpdateObject,
    isAssistant,
    inputTask,
    onChangeInputText,
    setMentionsModalActive,
    getInitialText,
    setInitialLinkedObject,
    onKeyEnterPressed,
}) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const projectIndex = ProjectHelper.getProjectIndexById(projectId)

    const getPlaceholderText = () => {
        const objectType = isSubtask ? 'subtask' : 'task'
        return translate(
            adding
                ? currentUserId === loggedUserId
                    ? `Type to add new ${objectType}`
                    : `Type to suggest a new ${objectType}`
                : `Write the name of the ${objectType}`
        )
    }

    const disableInput =
        !loggedUserCanUpdateObject ||
        tmpTask.genericData ||
        !accessGranted ||
        tmpTask.calendarData ||
        tmpTask.gmailData ||
        isAssistant

    useEffect(() => {
        if (!disableInput) inputTask.current?.focus()
    }, [disableInput])

    return (
        <CustomTextInput3
            forceBreaklinesLikeEnterAction={true}
            ref={inputTask}
            placeholder={getPlaceholderText()}
            placeholderTextColor={colors.Text03}
            onChangeText={onChangeInputText}
            autoFocus={true}
            setMentionsModalActive={setMentionsModalActive}
            projectId={projectId}
            projectIndex={projectIndex}
            externalAlignment={localStyles.textInputAlignment}
            containerStyle={[
                localStyles.textInputContainer,
                isSubtask && localStyles.subtaskTextInputContainer,
                isMiddleScreen && localStyles.inputUnderBreakpoint,
            ]}
            initialTextExtended={getInitialText()}
            wordStyle={isSubtask ? styles.body2 : undefined}
            disabledEdition={disableInput}
            styleTheme={isSubtask ? SUBTASK_THEME : TASK_THEME}
            inGenericTask={tmpTask.genericData ? true : false}
            genericData={tmpTask.genericData}
            userIdAllowedToEditTags={tmpTask.genericData ? NOT_ALLOW_EDIT_TAGS : null}
            setInitialLinkedObject={!adding ? setInitialLinkedObject : null}
            forceTriggerEnterActionForBreakLines={onKeyEnterPressed}
        />
    )
}

const localStyles = StyleSheet.create({
    textInputContainer: {
        marginTop: 2,
        marginBottom: 12,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 45, // 59 - (2 + 12)
        marginLeft: 51,
        marginRight: 40,
    },
    textInputAlignment: {
        paddingLeft: 0,
        paddingRight: 0,
    },
    inputUnderBreakpoint: {
        marginLeft: 43,
        marginRight: 32,
    },
    subtaskTextInputContainer: {
        marginBottom: 8,
        minHeight: 40, // 55 - (7 + 12)
    },
})
