import React, { useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { setDomAttributes } from '../../../../utils/setDomAttributes'

import Button from '../../../UIControls/Button'
import RunOutOfGoldAssistantModal from './BotOption/RunOutOfGoldAssistantModal'

// AT-3025: `setDictationSlot` receives the node the composer portals its blue mic into while it is
// empty; `micInSendSlot` says the mic is there now, so the Send button steps aside. The popover
// anchor stays mounted either way, so the out-of-Gold popup still has somewhere to open.
export default function SubmitButton({
    onSubmit,
    title,
    disabled,
    setShowRunOutGoalModal,
    showRunOutGoalModal,
    setDictationSlot,
    micInSendSlot = false,
}) {
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
            <View ref={buttonContainerRef} style={localStyles.slot}>
                {setDictationSlot ? <View ref={setDictationSlot} style={localStyles.slot} /> : null}
                {!micInSendSlot && (
                    <Button title={title} type="primary" icon="send" disabled={disabled} onPress={onSubmit} />
                )}
            </View>
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    slot: {
        flexDirection: 'row',
        alignItems: 'center',
    },
})
