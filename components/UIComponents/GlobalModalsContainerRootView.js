import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native'

import DueDateSinglePopup from '../UIComponents/DueDateSinglePopup'
import ProjectDontExistInInvitationModal from './ProjectDontExistInInvitationModal'

export default function GlobalModalsContainerRootView({}) {
    const goalSwipeMilestoneModalOpen = useSelector(state => state.goalSwipeMilestoneModalOpen)
    const showSwipeDueDatePopup = useSelector(state => state.showSwipeDueDatePopup.visible)
    const showProjectDontExistInInvitationModal = useSelector(state => state.showProjectDontExistInInvitationModal)

    return (
        <>
            {goalSwipeMilestoneModalOpen && <View style={localStyles.blocker} />}
            {showProjectDontExistInInvitationModal && <ProjectDontExistInInvitationModal />}
            {showSwipeDueDatePopup && <DueDateSinglePopup />}
        </>
    )
}

const localStyles = StyleSheet.create({
    blocker: {
        position: 'absolute',
        zIndex: 10000,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
    },
})
