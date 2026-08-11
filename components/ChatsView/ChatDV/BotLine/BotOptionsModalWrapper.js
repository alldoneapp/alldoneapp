import React, { useState } from 'react'
import { StyleSheet } from 'react-native'
import { shallowEqual, useSelector, useDispatch } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles from '../../../styles/global'
import Button from '../../../UIControls/Button'
import BotOptionsModal from '../EditorView/BotOption/BotOptionsModal'
import RunOutOfGoldAssistantModal from '../EditorView/BotOption/RunOutOfGoldAssistantModal'
import { setAssistantEnabled, setShowNotificationAboutTheBotBehavior } from '../../../../redux/actions'
import { resolveAssistantForProjectObject } from '../../../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

export default function BotOptionsModalWrapper({
    objectId,
    objectType,
    assistantId,
    setAssistantId,
    projectId,
    parentObject,
}) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const mainChatEditor = useSelector(state => state.mainChatEditor)
    const noticeAboutTheBotBehavior = useSelector(state => state.loggedUser.noticeAboutTheBotBehavior)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    useSelector(
        state => ({
            projectAssistants: state.projectAssistants,
            globalAssistants: state.globalAssistants,
            defaultAssistant: state.defaultAssistant,
            loggedUserProjects: state.loggedUserProjects,
            loggedUserProjectsMap: state.loggedUserProjectsMap,
        }),
        shallowEqual
    )

    const [isOpen, setIsOpen] = useState(false)

    const closeModal = () => {
        setIsOpen(false)
    }

    const openModal = () => {
        if (!noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))
        if (gold <= 0) dispatch(setAssistantEnabled(false))
        setIsOpen(true)
        document.activeElement.blur()
    }

    const onSelectBotOption = optionText => {
        setTimeout(() => {
            if (optionText) {
                mainChatEditor.setText(optionText)
                mainChatEditor.setSelection(optionText.length)
            } else {
                mainChatEditor.getSelection(true)
            }
        })
    }

    // Check if this is a webhook task and show task name
    const isWebhookTask = parentObject?.taskMetadata?.isWebhookTask
    const assistant = resolveAssistantForProjectObject(projectId, assistantId)
    const effectiveAssistantId = assistant?.uid || assistantId
    const { photoURL50, displayName } = assistant || {}
    const finalDisplayName = isWebhookTask ? `${displayName} (${parentObject.name})` : displayName

    return (
        <Popover
            content={
                gold > 0 ? (
                    <BotOptionsModal
                        closeModal={closeModal}
                        onSelectBotOption={onSelectBotOption}
                        assistantId={assistantId}
                        setAssistantId={setAssistantId}
                        projectId={projectId}
                        objectId={objectId}
                        objectType={objectType}
                        inChatTab={true}
                    />
                ) : (
                    <RunOutOfGoldAssistantModal closeModal={closeModal} />
                )
            }
            align={'start'}
            position={['top']}
            onClickOutside={closeModal}
            isOpen={isOpen && noticeAboutTheBotBehavior && !showNotificationAboutTheBotBehavior}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Button
                ref={ref => (this.botBtnRef = ref)}
                type={'ghost'}
                noBorder={true}
                onPress={openModal}
                customIcon={<AssistantAvatar photoURL={photoURL50} assistantId={effectiveAssistantId} size={24} />}
                title={finalDisplayName}
                titleStyle={localStyles.text}
            />
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    text: {
        ...styles.title7,
        paddingVertical: 7,
        letterSpacing: 0,
    },
})
