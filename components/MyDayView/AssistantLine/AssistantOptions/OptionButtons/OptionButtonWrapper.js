import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import OptionButton from './OptionButton'
import PreConfigTaskGeneratorModal from '../../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal'
import RunOutOfGoldAssistantModal from '../../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'

export default function OptionButtonWrapper({ projectId, containerStyle, text, icon, task, assistant }) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const isExecuting = useSelector(state => state.preConfigTaskExecuting)
    const [isOpen, setIsOpen] = useState(false)
    const isUnmountedRef = useRef(false)

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
        }
    }, [])

    const safeSetIsOpen = value => {
        if (!isUnmountedRef.current) {
            setIsOpen(value)
        }
    }

    const openModal = () => {
        safeSetIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        safeSetIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <>
            {isOpen ? (
                <Popover
                    content={
                        gold > 0 ? (
                            <PreConfigTaskGeneratorModal
                                projectId={projectId}
                                closeModal={closeModal}
                                task={task}
                                assistant={assistant}
                            />
                        ) : (
                            <RunOutOfGoldAssistantModal closeModal={closeModal} />
                        )
                    }
                    align={'start'}
                    position={['bottom', 'left', 'right', 'top']}
                    onClickOutside={closeModal}
                    isOpen
                    contentLocation={null}
                    disableReposition
                >
                    <OptionButton
                        text={text}
                        icon={icon}
                        containerStyle={containerStyle}
                        onPress={openModal}
                        disabled={isExecuting}
                    />
                </Popover>
            ) : (
                <OptionButton
                    text={text}
                    icon={icon}
                    containerStyle={containerStyle}
                    onPress={openModal}
                    disabled={isExecuting}
                />
            )}
        </>
    )
}
