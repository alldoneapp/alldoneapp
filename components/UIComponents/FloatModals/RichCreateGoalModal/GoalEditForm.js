import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import InputArea from './InputArea'
import ButtonsArea from './ButtonsArea/ButtonsArea'

export default function GoalEditForm({
    projectId,
    isAssigneeVisible,
    goal,
    setGoal,
    createGoal,
    showDateRange,
    showPrivacy,
    showAssignees,
    showDescription,
    showHighlight,
}) {
    const [mentionsModalActive, setMentionsModalActive] = useState(false)

    const onChangeInputText = text => {
        const formatedText = text.replace(/\r?\n|\r/g, '')
        setGoal({ ...goal, extendedName: formatedText, name: TasksHelper.getTaskNameWithoutMeta(formatedText) })
    }

    const enterKeyAction = event => {
        const { isQuillTagEditorOpen, openModals } = store.getState()
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            if (!mentionsModalActive && !isAssigneeVisible) {
                createGoal()
                if (event) event.preventDefault()
            }
        }
    }

    return (
        <View style={localStyles.container}>
            <InputArea
                projectId={projectId}
                goal={goal}
                onChangeInputText={onChangeInputText}
                enterKeyAction={enterKeyAction}
                setMentionsModalActive={setMentionsModalActive}
            />
            <ButtonsArea
                projectId={projectId}
                goal={goal}
                showDateRange={showDateRange}
                showPrivacy={showPrivacy}
                showAssignees={showAssignees}
                showDescription={showDescription}
                showHighlight={showHighlight}
                enterKeyAction={enterKeyAction}
                createGoal={createGoal}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
})
