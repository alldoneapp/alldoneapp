import React, { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import Popover from 'react-tiny-popover'

import BotButton from './BotButton'
import BotButtonInModal from './BotButtonInModal'
import { setAssistantEnabled, setShowNotificationAboutTheBotBehavior } from '../../../../../redux/actions'
import BotOptionsModal from './BotOptionsModal'
import RunOutOfGoldAssistantModal from './RunOutOfGoldAssistantModal'
import { isModalOpen, MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'

export default function BotButtonWrapper({
    onSelectBotOption,
    inModal,
    objectId,
    objectType,
    projectId,
    assistantId,
    setAssistantId,
}) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const noticeAboutTheBotBehavior = useSelector(state => state.loggedUser.noticeAboutTheBotBehavior)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        if (!noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))
        if (gold <= 0) dispatch(setAssistantEnabled(false))
        setIsOpen(true)
        document.activeElement.blur()
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
                <BotButtonInModal onPress={openModal} projectId={projectId} assistantId={assistantId} />
            ) : (
                <BotButton onPress={openModal} projectId={projectId} assistantId={assistantId} />
            )}
        </Popover>
    )
}
