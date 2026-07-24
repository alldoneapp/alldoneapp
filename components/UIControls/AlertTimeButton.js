import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import moment from 'moment'
import { useDispatch } from 'react-redux'

import Button from './Button'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import AlertTimeModal from '../UIComponents/FloatModals/AlertTimeModal/AlertTimeModal'
import { translate } from '../../i18n/TranslationService'

export default function AlertTimeButton({ task, projectId, disabled }) {
    const dispatch = useDispatch()
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
    }

    const delayHidePopover = () => {
        const t = setTimeout(() => {
            hidePopover()
        })
        timeoutsRef.current.push(t)
    }

    const showPopover = () => {
        if (!visiblePopover && !disabled) {
            safeSetVisiblePopover(true)
            dispatch(showFloatPopup())
            if (document.activeElement) {
                document.activeElement.blur()
            }
        }
    }

    const getAlertTimeButtonText = () => {
        if (!task?.alertEnabled || !task?.dueDate) {
            return null
        }
        const timeFormat = getTimeFormat()
        return moment(task.dueDate).format(timeFormat)
    }

    const buttonText = getAlertTimeButtonText()

    return visiblePopover ? (
        <Popover
            content={
                <AlertTimeModal
                    task={task}
                    projectId={projectId}
                    closePopover={hidePopover}
                    delayClosePopover={delayHidePopover}
                />
            }
            onClickOutside={delayHidePopover}
            isOpen={visiblePopover}
            positions={['bottom', 'top', 'left', 'right']}
            containerStyle={{ zIndex: 10000 }}
        >
            <Button title={buttonText} type={'ghost'} icon={'bell'} onPress={showPopover} disabled={disabled} />
        </Popover>
    ) : (
        <Button title={buttonText} type={'ghost'} icon={'bell'} onPress={showPopover} disabled={disabled} />
    )
}
