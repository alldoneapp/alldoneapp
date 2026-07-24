import React, { useRef, useEffect } from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import Button from '../../../UIControls/Button'
import RunOutOfGoldAssistantModal from './BotOption/RunOutOfGoldAssistantModal'

export default function SubmitButton({ onSubmit, title, disabled, setShowRunOutGoalModal, showRunOutGoalModal }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const buttonContainerRef = useRef(null)

    const closeModal = () => {
        setShowRunOutGoalModal(false)
    }

    useEffect(() => {
        buttonContainerRef.current.setNativeProps({
            'check-box-id': 'buttonContainerId',
        })
    }, [])

    return (
        <Popover
            content={<RunOutOfGoldAssistantModal closeModal={closeModal} showAssistantDisabledText={true} />}
            align={'start'}
            position={['top']}
            onClickOutside={closeModal}
            isOpen={showRunOutGoalModal}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <View ref={buttonContainerRef}>
                <Button title={title} type="primary" icon="send" disabled={disabled} onPress={onSubmit} />
            </View>
        </Popover>
    )
}
