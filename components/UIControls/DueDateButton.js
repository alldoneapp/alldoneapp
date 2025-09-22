import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import moment from 'moment'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import Button from './Button'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../i18n/TranslationService'
import DueDateModal from '../UIComponents/FloatModals/DueDateModal/DueDateModal'

export default function DueDateButton({
    onDismissPopup,
    task,
    inEditTask,
    isObservedTask,
    projectId,
    disabled,
    style,
    saveDueDateBeforeSaveTask,
    setToBacklogBeforeSaveTask,
    shortcutText,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [visiblePopover, setVisiblePopover] = useState(false)
    const isUnmountedRef = useRef(false)
    const timeoutsRef = useRef([])

    useEffect(() => {
        return () => {
            isUnmountedRef.current = true
            timeoutsRef.current.forEach(t => clearTimeout(t))
            timeoutsRef.current = []
        }
    }, [])

    const safeSetVisiblePopover = value => {
        if (!isUnmountedRef.current) {
            setVisiblePopover(value)
        }
    }

    const hidePopover = () => {
        safeSetVisiblePopover(false)
        dispatch(hideFloatPopup())
        if (onDismissPopup) onDismissPopup()
    }

    const delayHidePopover = () => {
        // This timeout is necessary to stop the propagation of the click
        // to close the Modal, and reach the dismiss event of the EditTask
        const t = setTimeout(async () => {
            hidePopover()
        })
        timeoutsRef.current.push(t)
    }

    const showPopover = () => {
        if (!visiblePopover) {
            safeSetVisiblePopover(true)
            dispatch(showFloatPopup())
            document.activeElement.blur()
        }
    }

    const getDueDateButtonText = () => {
        const today = moment()
        const dueDate = moment(isObservedTask ? task.dueDateByObserversIds[currentUserId] : task.dueDate)
        const inBacklog = isObservedTask
            ? task.dueDateByObserversIds[currentUserId] === Number.MAX_SAFE_INTEGER
            : task.dueDate === Number.MAX_SAFE_INTEGER

        return inEditTask && smallScreen
            ? null
            : inBacklog
            ? translate('Someday')
            : dueDate.isSame(today, 'day')
            ? translate('Today')
            : dueDate.format(getDateFormat(false, true))
    }

    return visiblePopover ? (
        <Popover
            content={
                <DueDateModal
                    task={task}
                    projectId={projectId}
                    closePopover={hidePopover}
                    delayClosePopover={delayHidePopover}
                    inEditTask={inEditTask}
                    saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                    setToBacklogBeforeSaveTask={setToBacklogBeforeSaveTask}
                    isObservedTask={isObservedTask}
                />
            }
            onClickOutside={delayHidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <Hotkeys
                keyName={`alt+${shortcutText}`}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, showPopover, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.buttonRef = ref)}
                    title={getDueDateButtonText()}
                    type={'ghost'}
                    noBorder={inEditTask && smallScreen}
                    icon={'calendar'}
                    buttonStyle={style}
                    onPress={showPopover}
                    disabled={disabled}
                    shortcutText={shortcutText}
                />
            </Hotkeys>
        </Popover>
    ) : (
        <Hotkeys
            keyName={`alt+${shortcutText}`}
            disabled={disabled}
            onKeyDown={(sht, event) => execShortcutFn(this.buttonRef, showPopover, event)}
            filter={e => true}
        >
            <Button
                ref={ref => (this.buttonRef = ref)}
                title={getDueDateButtonText()}
                type={'ghost'}
                noBorder={inEditTask && smallScreen}
                icon={'calendar'}
                buttonStyle={style}
                onPress={showPopover}
                disabled={disabled}
                shortcutText={shortcutText}
            />
        </Hotkeys>
    )
}
