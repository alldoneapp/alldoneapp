import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import DragTaskModal from './DragTaskModal'
import DragGoalModal from './DragGoalModal'
import {
    setActiveDragGoalMode,
    setActiveDragProjectModeType,
    setActiveDragSkillModeId,
    setActiveDragTaskModeInMyDay,
} from '../../../redux/actions'

export default function DragModalsContainer() {
    const dispatch = useDispatch()
    const activeDragProjectModeType = useSelector(state => state.activeDragProjectModeType)
    const activeDragSkillModeId = useSelector(state => state.activeDragSkillModeId)
    const activeDragGoalMode = useSelector(state => state.activeDragGoalMode)
    const activeDragTaskModeInDate = useSelector(state => state.activeDragTaskModeInDate)
    const activeDragTaskModeInMyDay = useSelector(state => state.activeDragTaskModeInMyDay)

    const closeGoalDragMode = () => {
        dispatch(setActiveDragGoalMode(false))
    }

    const closeSkillDragMode = () => {
        dispatch(setActiveDragSkillModeId(false))
    }

    const closeProjectDragMode = () => {
        dispatch(setActiveDragProjectModeType(null))
    }

    const closeTaskMyDayDragMode = () => {
        dispatch(setActiveDragTaskModeInMyDay(false))
    }

    return (
        <>
            {activeDragTaskModeInDate && <DragTaskModal projectId={activeDragTaskModeInDate.projectId} />}
            {activeDragGoalMode && <DragGoalModal closeDragMode={closeGoalDragMode} />}
            {activeDragSkillModeId && <DragGoalModal closeDragMode={closeSkillDragMode} />}
            {activeDragProjectModeType && <DragGoalModal closeDragMode={closeProjectDragMode} />}
            {activeDragTaskModeInMyDay && <DragGoalModal closeDragMode={closeTaskMyDayDragMode} />}
        </>
    )
}
