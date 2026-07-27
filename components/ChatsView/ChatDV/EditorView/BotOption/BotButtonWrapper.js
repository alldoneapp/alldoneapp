import React, { useState, useEffect } from 'react'
import { shallowEqual, useSelector, useDispatch } from 'react-redux'
import Popover from 'react-tiny-popover'

import BotButton from './BotButton'
import BotButtonInModal from './BotButtonInModal'
import { setAssistantEnabled, setShowNotificationAboutTheBotBehavior } from '../../../../../redux/actions'
import BotOptionsModal from './BotOptionsModal'
import RunOutOfGoldAssistantModal from './RunOutOfGoldAssistantModal'
import { isModalOpen, MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import { setObjectAssistantEnabled } from '../../../../../utils/assistantHelper'
import { resolveAssistantForProjectObject } from '../../../../AdminPanel/Assistants/assistantsHelper'
import { setAssistantForObject } from './objectAssistantHelper'

export default function BotButtonWrapper({
    onSelectBotOption,
    inModal,
    objectId,
    objectType,
    projectId,
    assistantId,
    setAssistantId,
    assistantEnabled,
    updateObjectState,
}) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const noticeAboutTheBotBehavior = useSelector(state => state.loggedUser.noticeAboutTheBotBehavior)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
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
    const [optimisticAssistantEnabled, setOptimisticAssistantEnabled] = useState(assistantEnabled)
    const assistant = resolveAssistantForProjectObject(projectId, assistantId)
    const effectiveAssistantId = assistant?.uid || assistantId

    useEffect(() => {
        setOptimisticAssistantEnabled(assistantEnabled)
    }, [assistantEnabled])

    const openModal = () => {
        if (!noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))
        if (gold <= 0) dispatch(setAssistantEnabled(false))
        setIsOpen(true)
        document.activeElement.blur()
    }

    const enableAssistant = async () => {
        if (effectiveAssistantId && effectiveAssistantId !== assistantId) {
            try {
                await setAssistantForObject(projectId, objectId, objectType, effectiveAssistantId, !!assistantId)
                setAssistantId?.(effectiveAssistantId)
            } catch (error) {
                console.error('Error assigning the default assistant to object:', error)
                return
            }
        }

        setOptimisticAssistantEnabled(true)
        setObjectAssistantEnabled(projectId, objectId, objectType, true)
        dispatch(setAssistantEnabled(true))
        if (updateObjectState) updateObjectState({ isAssistantEnabled: true })
        if (document.activeElement) document.activeElement.blur()
    }

    const onPress = () => {
        if (!noticeAboutTheBotBehavior) {
            dispatch(setShowNotificationAboutTheBotBehavior(true))
            return
        }
        if (gold <= 0) {
            openModal()
            return
        }
        if (!optimisticAssistantEnabled) {
            return enableAssistant()
        }
        openModal()
    }

    const closeModal = () => {
        if (isModalOpen(MENTION_MODAL_ID)) return
        setIsOpen(false)
    }

    useEffect(() => {
        return () => {
            dispatch(setAssistantEnabled(false))
        }
    }, [])

    return (
        <Popover
            content={
                gold > 0 ? (
                    <BotOptionsModal
                        closeModal={closeModal}
                        onSelectBotOption={onSelectBotOption}
                        objectId={objectId}
                        assistantId={assistantId}
                        projectId={projectId}
                        objectType={objectType}
                        setAssistantId={setAssistantId}
                        inChatTab={true}
                        parentObject={{ isAssistantEnabled: optimisticAssistantEnabled }}
                        updateObjectState={updatedObj => {
                            if (updatedObj.isAssistantEnabled !== undefined) {
                                setOptimisticAssistantEnabled(updatedObj.isAssistantEnabled)
                            }
                            if (updateObjectState) {
                                updateObjectState(updatedObj)
                            }
                        }}
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
            {inModal ? (
                <BotButtonInModal
                    onPress={onPress}
                    projectId={projectId}
                    assistantId={effectiveAssistantId}
                    isAssistantEnabled={optimisticAssistantEnabled}
                />
            ) : (
                <BotButton
                    onPress={onPress}
                    projectId={projectId}
                    assistantId={effectiveAssistantId}
                    isAssistantEnabled={optimisticAssistantEnabled}
                />
            )}
        </Popover>
    )
}
