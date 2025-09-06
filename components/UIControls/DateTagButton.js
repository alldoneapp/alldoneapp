import React, { useState } from 'react'
import DueDateModal from '../UIComponents/FloatModals/DueDateModal/DueDateModal'
import Popover from 'react-tiny-popover'
import moment from 'moment'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import DateTag from '../Tags/DateTag'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

export default function DateTagButton({
    task,
    projectId,
    isObservedTask,
    isMobile,
    onDismissPopup,
    disabled,
    style,
    saveDueDateBeforeSaveTask,
    outline = false,
}) {
    const smallScreen = useSelector(state => state.smallScreen)
    const currentUser = useSelector(state => state.currentUser)
    const [visiblePopover, setVisiblePopover] = useState(false)
    const dispatch = useDispatch()
    const date = task.done
        ? task.completed
        : isObservedTask
        ? task.dueDateByObserversIds[currentUser.uid]
        : task.dueDate
    const icon = task.done ? 'square-checked-gray' : isObservedTask ? 'calendar-observer' : 'calendar'

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
    }

    const delayHidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditTask
        setTimeout(async () => {
            hidePopover()
        })
    }

    const showPopover = () => {
        /* istanbul ignore next */
        if (!visiblePopover) {
            setVisiblePopover(true)
            dispatch(showFloatPopup())
        }
    }

    return visiblePopover ? (
        <Popover
            content={
                <DueDateModal
                    task={task}
                    projectId={projectId}
                    closePopover={hidePopover}
                    delayClosePopover={delayHidePopover}
                    isObservedTask={isObservedTask}
                    saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                />
            }
            onClickOutside={delayHidePopover}
            isOpen={true}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <DateTag
                date={moment(date).format(getDateFormat())}
                style={style}
                isMobile={isMobile}
                onPress={hidePopover}
                icon={icon}
                outline={outline}
                disabled={disabled}
            />
        </Popover>
    ) : (
        <DateTag
            date={moment(date).format(getDateFormat())}
            style={style}
            isMobile={isMobile}
            onPress={showPopover}
            icon={icon}
            outline={outline}
            disabled={disabled}
        />
    )
}
