import React, { useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import GoalsProgressModal from '../UIComponents/FloatModals/GoalsProgressModal/GoalsProgressModal'
import GoalsDoneProgressModal from '../UIComponents/FloatModals/GoalsProgressModal/GoalsDoneProgressModal'
import GoalProgress from './GoalProgress'
import Backend from '../../utils/BackendBridge'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { storeModal, removeModal, MENTION_MODAL_ID, GOAL_PROGRESS_MODAL_ID } from '../ModalsManager/modalsManager'
import { checkIsLimitedByXp } from '../Premium/PremiumHelper'

export default function GoalProgressWrapper({
    goal,
    projectId,
    disabled,
    style,
    updateProgress,
    progress,
    inDoneMilestone,
    dynamicProgress,
}) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        if (inDoneMilestone || !checkIsLimitedByXp(projectId)) {
            setIsOpen(true)
            dispatch(showFloatPopup())
            storeModal(GOAL_PROGRESS_MODAL_ID)
        }
    }

    const closeModal = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            setIsOpen(false)
            dispatch(hideFloatPopup())
            removeModal(GOAL_PROGRESS_MODAL_ID)
        }
    }

    const selectProgress = (newProgress, addedComment) => {
        setTimeout(() => {
            closeModal()
            if (updateProgress) {
                updateProgress(newProgress, addedComment)
            } else {
                if (newProgress !== progress) Backend.updateGoalProgress(projectId, newProgress, goal)
            }
        })
    }

    return (
        <Popover
            key={!isOpen}
            content={
                inDoneMilestone ? (
                    <GoalsDoneProgressModal closeModal={closeModal} />
                ) : (
                    <GoalsProgressModal
                        closeModal={closeModal}
                        updateProgress={selectProgress}
                        progress={progress}
                        projectId={projectId}
                        goal={goal}
                    />
                )
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <View style={[{ marginTop: 4 }, style]}>
                <GoalProgress
                    projectId={projectId}
                    openModal={openModal}
                    progress={progress}
                    disabled={disabled}
                    dynamicProgress={dynamicProgress}
                />
            </View>
        </Popover>
    )
}
