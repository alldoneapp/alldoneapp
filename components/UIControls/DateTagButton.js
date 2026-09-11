import React, { useEffect, useRef, useState } from 'react'
import DueDateModal from '../UIComponents/FloatModals/DueDateModal/DueDateModal'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import moment from 'moment'
import { useSelector } from 'react-redux'
import DateTag from '../Tags/DateTag'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import useFloatPopupLock from '../../hooks/useFloatPopupLock'

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
    const isUnmountedRef = useRef(false)
    const hideTimeoutRef = useRef(null)
    const popupLock = useFloatPopupLock()
    const date = task.done
        ? task.completed
        : isObservedTask
          ? task.dueDateByObserversIds[currentUser.uid]
          : task.dueDate
    const icon = task.done ? 'square-checked-gray' : isObservedTask ? 'calendar-observer' : 'calendar'

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
        }
    }, [])

    const hidePopover = () => {
        if (isUnmountedRef.current) return
        setVisiblePopover(false)
        popupLock.release()
        if (onDismissPopup) onDismissPopup()
    }

    const delayHidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditTask
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = setTimeout(() => {
            hideTimeoutRef.current = null
            hidePopover()
        })
    }

    const showPopover = () => {
        /* istanbul ignore next */
        if (!visiblePopover) {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current)
                hideTimeoutRef.current = null
            }
            setVisiblePopover(true)
            popupLock.acquire()
        }
    }

    return visiblePopover ? (
        <AppPopover
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
        </AppPopover>
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
