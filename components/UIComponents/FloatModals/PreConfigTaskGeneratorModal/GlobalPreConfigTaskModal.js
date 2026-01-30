import React from 'react'
import { StyleSheet, View, TouchableOpacity, TouchableWithoutFeedback } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { setPreConfigTaskModalData } from '../../../../redux/actions'
import PreConfigTaskGeneratorModal from './PreConfigTaskGeneratorModal'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { isModalOpen, MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'

export default function GlobalPreConfigTaskModal() {
    const dispatch = useDispatch()
    const preConfigTaskModalData = useSelector(state => state.preConfigTaskModalData)
    const gold = useSelector(state => state.loggedUser.gold)
    const { visible, task, assistant, projectId } = preConfigTaskModalData

    console.log('[GlobalPreConfigTaskModal] Render state:', {
        visible,
        hasTask: !!task,
        hasAssistant: !!assistant,
        assistantUid: assistant?.uid,
        projectId,
        gold,
    })

    const closeModal = () => {
        if (isModalOpen(MENTION_MODAL_ID)) return
        dispatch(setPreConfigTaskModalData(false, null, null, null))
    }

    // Only require assistant.uid since PreConfigTaskGeneratorModal uses assistant.uid
    if (!visible || !task || !assistant?.uid || !projectId) {
        console.log('[GlobalPreConfigTaskModal] Not rendering - missing data')
        return null
    }

    console.log('[GlobalPreConfigTaskModal] Rendering modal with:', {
        taskName: task?.name,
        assistantName: assistant?.displayName,
    })

    return (
        <View style={localStyles.overlay}>
            <TouchableWithoutFeedback onPress={closeModal}>
                <View style={localStyles.backdrop} />
            </TouchableWithoutFeedback>
            <View style={localStyles.modalContainer}>
                {gold > 0 ? (
                    <PreConfigTaskGeneratorModal
                        projectId={projectId}
                        closeModal={closeModal}
                        task={task}
                        assistant={assistant}
                    />
                ) : (
                    <RunOutOfGoldAssistantModal closeModal={closeModal} />
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        justifyContent: 'center',
        alignItems: 'center',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContainer: {
        zIndex: 10000,
    },
})
