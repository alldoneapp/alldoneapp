import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import Backend from '../../../../utils/BackendBridge'
import InputArea from './InputArea'
import ButtonsArea from './ButtonsArea'

export default function TaskEditForm({
    projectId,
    isAssigneeVisible,
    task,
    setTask,
    onSuccess,
    mentions,
    setMentions,
    showDueDate,
    showPrivacy,
    showEstimation,
    showParentGoal,
    showMoreOptions,
}) {
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const [linkedParentNotesUrl, setLinkedParentNotesUrl] = useState([])
    const [linkedParentTasksUrl, setLinkedParentTasksUrl] = useState([])
    const [linkedParentContactsUrl, setLinkedParentContactsUrl] = useState([])
    const [linkedParentProjectsUrl, setLinkedParentProjectsUrl] = useState([])
    const [linkedParentGoalsUrl, setLinkedParentGoalsUrl] = useState([])
    const [linkedParentSkillsUrl, setLinkedParentSkillsUrl] = useState([])
    const [linkedParentAssistantsUrl, setLinkedParentAssistantsUrl] = useState([])

    const onChangeInputText = (
        text,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        if (text) {
            setLinkedParentContactsUrl(linkedParentContactsUrl)
            setLinkedParentGoalsUrl(linkedParentGoalsUrl)
            setLinkedParentNotesUrl(linkedParentNotesUrl)
            setLinkedParentProjectsUrl(linkedParentProjectsUrl)
            setLinkedParentSkillsUrl(linkedParentSkillsUrl)
            setLinkedParentAssistantsUrl(linkedParentAssistantsUrl)
            setLinkedParentTasksUrl(linkedParentTasksUrl)
        }
        setTaskProperty('name', text.replace(/\r?\n|\r/g, ''))
    }

    const trySetLinkedObjects = task => {
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
            { type: 'task', id: task.id }
        )
    }

    const setTaskProperty = (property, value) => {
        if (property === 'name') {
            setTask({ ...task, extendedName: value, name: TasksHelper.getTaskNameWithoutMeta(value) })
        } else {
            setTask({ ...task, [property]: value })
        }
    }

    const done = () => {
        if (onSuccess) onSuccess(trySetLinkedObjects)
    }

    const enterKeyAction = event => {
        const { isQuillTagEditorOpen, openModals } = store.getState()
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            if (!mentionsModalActive && !isAssigneeVisible) {
                done()
                if (event) event.preventDefault()
            }
        }
    }

    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') enterKeyAction(event)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.container}>
            <InputArea
                projectId={projectId}
                task={task}
                mentions={mentions}
                setMentions={setMentions}
                onChangeInputText={onChangeInputText}
                enterKeyAction={enterKeyAction}
                setMentionsModalActive={setMentionsModalActive}
            />
            <ButtonsArea
                projectId={projectId}
                task={task}
                showDueDate={showDueDate}
                showPrivacy={showPrivacy}
                showEstimation={showEstimation}
                showParentGoal={showParentGoal}
                showMoreOptions={showMoreOptions}
                enterKeyAction={enterKeyAction}
                done={done}
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
