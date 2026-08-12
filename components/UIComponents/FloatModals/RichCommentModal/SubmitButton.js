import React, { useRef, useEffect } from 'react'
import { useSelector } from 'react-redux'
import AppPopover from '../../ModalShell/AppPopover'
import { View } from 'react-native'
import { setDomAttributes } from '../../../../utils/setDomAttributes'

import Button from '../../../UIControls/Button'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'

export default function SubmitButton({ onSubmit, disabled, setShowRunOutGoalModal, showRunOutGoalModal }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const buttonContainerRef = useRef(null)

    const closeModal = () => {
        setShowRunOutGoalModal(false)
    }

    useEffect(() => {
        setDomAttributes(buttonContainerRef.current, {
            'check-box-id': 'buttonContainerId',
        })
    }, [])

    return (
        <AppPopover
            content={<RunOutOfGoldAssistantModal closeModal={closeModal} showAssistantDisabledText={true} />}
            align={'start'}
            position={['top']}
            onClickOutside={closeModal}
            isOpen={showRunOutGoalModal}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <View ref={buttonContainerRef}>
                <Button
                    icon={'plus'}
                    iconColor={'#ffffff'}
                    type={'primary'}
                    onPress={event => {
                        event?.preventDefault?.()
                        event?.stopPropagation?.()
                        onSubmit()
                    }}
                    shortcutText={'Enter'}
                    forceShowShortcut={true}
                    disabled={disabled}
                />
            </View>
        </AppPopover>
    )
}
