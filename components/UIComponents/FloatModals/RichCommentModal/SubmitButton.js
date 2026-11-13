import React, { useRef, useEffect } from 'react'
import { useSelector } from 'react-redux'
import AppPopover from '../../ModalShell/AppPopover'
import { StyleSheet, View } from 'react-native'
import { setDomAttributes } from '../../../../utils/setDomAttributes'

import Button from '../../../UIControls/Button'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'

// AT-3025: `setDictationSlot` receives the node the comment input portals its blue mic into while
// the comment is empty; `micInSendSlot` says the mic is there now, so this button steps aside. The
// popover anchor stays mounted either way, so the out-of-Gold popup still has somewhere to open.
export default function SubmitButton({
    onSubmit,
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
