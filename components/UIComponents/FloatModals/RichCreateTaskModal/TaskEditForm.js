import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import Backend from '../../../../utils/BackendBridge'
import InputArea from './InputArea'
import ButtonsArea from './ButtonsArea'
import { translate } from '../../../../i18n/TranslationService'

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
    showRecurring,
    showParentGoal,
    showMoreOptions,
    uploadingDraft,
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
        if (key !== 'Enter') return
        // Holding Return down repeats the keydown event, and an IME commit
        // reports its own Enter. Neither is a second intended submission.
        if (event.repeat || event.isComposing || event.keyCode === 229) return
        enterKeyAction(event)
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
            {(uploadingDraft || task.description?.includes('blob:')) && (
                <Text style={localStyles.attachmentHint} accessibilityLiveRegion="polite">
                    {translate(uploadingDraft ? 'Adding files to description' : 'Files added to description')}
                </Text>
            )}
            <ButtonsArea
                projectId={projectId}
                task={task}
                showDueDate={showDueDate}
                showPrivacy={showPrivacy}
                showRecurring={showRecurring}
                showParentGoal={showParentGoal}
                showMoreOptions={showMoreOptions}
                done={done}
                uploadingDraft={uploadingDraft}
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
    attachmentHint: {
        color: '#ffffff',
        fontSize: 12,
        marginHorizontal: 16,
        marginBottom: 8,
    },
})
