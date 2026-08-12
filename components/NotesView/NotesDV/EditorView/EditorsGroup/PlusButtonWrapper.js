import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import AppPopover from '../../../../UIComponents/ModalShell/AppPopover'

import EditorsModal from './EditorsModal'
import EditorPlusButton from './EditorPlusButton'

export default function PlusButtonWrapper({ editors, markAssignee = false }) {
    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        setShowModal(true)
    }

    const closeModal = () => {
        setShowModal(false)
    }

    return (
        <AppPopover
            content={
                <View>
                    <EditorsModal closeModal={closeModal} editors={editors} markAssignee={markAssignee} />
                </View>
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['bottom', 'top', 'right', 'left']}
            padding={4}
            align={'start'}
        >
            <EditorPlusButton editorsAmount={editors.length} openModal={openModal} />
        </AppPopover>
    )
}

const localStyles = StyleSheet.create({
    modalWrapper: {
        paddingHorizontal: 20,
        paddingBottom: 35,
        paddingTop: 10,
    },
})
