import Popover from 'react-tiny-popover'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'
import React, { useState } from 'react'

import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import DueDateModal from '../UIComponents/FloatModals/DueDateModal/DueDateModal'
import DateTag from '../Tags/DateTag'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import Backend from '../../utils/BackendBridge'
import { BACKLOG_DATE_NUMERIC } from '../TaskListView/Utils/TasksHelper'
import { translate } from '../../i18n/TranslationService'

export default function GoalDateTagButton({
    projectId,
    disabled,
    goal,
    isEmptyGoal,
    parentGoaltasks,
    areObservedTask,
    inParentGoal,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [visiblePopover, setVisiblePopover] = useState(false)

    const { assigneesReminderDate, startingMilestoneDate, completionMilestoneDate } = goal
    const date =
        assigneesReminderDate[currentUserId] === BACKLOG_DATE_NUMERIC
            ? translate('Someday')
            : moment(assigneesReminderDate[currentUserId]).format(getDateFormat())

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    const updateReminder = date => {
        Backend.updateGoalAssigneeReminderDate(projectId, goal.id, currentUserId, date)
    }

    const firstTask = isEmptyGoal ? { dueDate: assigneesReminderDate[currentUserId] } : parentGoaltasks[0]

    return visiblePopover ? (
        <Popover
            content={
                <DueDateModal
                    projectId={projectId}
                    task={firstTask}
                    closePopover={hidePopover}
                    delayClosePopover={hidePopover}
                    multipleTasks={!isEmptyGoal}
                    tasks={isEmptyGoal ? [] : parentGoaltasks}
                    isObservedTask={areObservedTask}
                    inParentGoal={inParentGoal}
                    updateParentGoalReminderDate={updateReminder}
                    goalCompletionDate={completionMilestoneDate}
                    goalStartingDate={startingMilestoneDate}
                    goal={goal}
                />
            }
            onClickOutside={hidePopover}
            isOpen={true}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <DateTag
                date={date}
                onPress={hidePopover}
                icon={'calendar'}
                disabled={disabled}
                style={{ marginLeft: 8 }}
            />
        </Popover>
    ) : (
        <DateTag date={date} onPress={showPopover} icon={'calendar'} disabled={disabled} style={{ marginLeft: 8 }} />
    )
}
