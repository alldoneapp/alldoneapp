import React from 'react'
import { useSelector } from 'react-redux'
import TaskParentGoalModal from './TaskParentGoalModal'
import GoalTagIcon from '../../../Tags/GoalTagIcon'
import { exitsOpenModals, TASK_PARENT_GOAL_MODAL_ID } from '../../../ModalsManager/modalsManager'
import withSafePopover from '../../HOC/withSafePopover'

function WrapperTaskParentGoalModal({ projectId, activeGoal, dateFormated, openPopover, closePopover, isOpen }) {
    const mobile = useSelector(state => state.smallScreenNavigation)

    const handleClose = () => {
        if (!exitsOpenModals([TASK_PARENT_GOAL_MODAL_ID])) {
            closePopover()
        }
    }

    return (
        <>
            <GoalTagIcon onPress={openPopover} disabled={isOpen} highlightIcon={!!activeGoal} />
            {isOpen && (
                <TaskParentGoalModal
                    key={isOpen}
                    activeGoal={activeGoal}
                    projectId={projectId}
                    closeModal={handleClose}
                    delalyPrivacyModalClose={true}
                    fromAddTaskSection={true}
                    dateFormated={dateFormated}
                />
            )}
        </>
    )
}

export default withSafePopover(WrapperTaskParentGoalModal)
