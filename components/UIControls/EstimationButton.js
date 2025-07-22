import React, { useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import EstimationModal from '../UIComponents/FloatModals/EstimationModal/EstimationModal'
import Button from './Button'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { execShortcutFn } from '../../utils/HelperFunctions'
import { translate } from '../../i18n/TranslationService'
import { ESTIMATION_0_MIN, getEstimationIconByValue } from '../../utils/EstimationHelper'
import { setTaskAutoEstimation } from '../../utils/backends/Tasks/tasksFirestore'
import { getTaskAutoEstimation, OPEN_STEP } from '../TaskListView/Utils/TasksHelper'

export default function EstimationButton({
    task,
    projectId,
    disabled,
    setEstimationFn,
    onDismissPopup,
    shortcutText,
    style,
    isObservedTask,
    isToReviewTask,
    editing,
    setTempAutoEstimation,
    isPending,
}) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [visiblePopover, setVisiblePopover] = useState(false)

    let buttonRef = useRef().current

    const { estimations, stepHistory, estimationsByObserverIds } = task
    const currentStepId = stepHistory[stepHistory.length - 1]
    const currentEstimation = isPending
        ? estimations[OPEN_STEP]
        : isObservedTask && !isToReviewTask
        ? estimationsByObserverIds[currentUserId]
        : estimations[currentStepId] || ESTIMATION_0_MIN

    const hidePopover = () => {
        setTimeout(async () => {
            setVisiblePopover(false)
            dispatch(hideFloatPopup())

            if (onDismissPopup) onDismissPopup()
        })
    }

    const showPopover = () => {
        if (!visiblePopover) {
            setVisiblePopover(true)
            dispatch(showFloatPopup())
        }
    }

    const closePopover = () => {
        setVisiblePopover(false)
        hidePopover()
    }

    const setAutoEstimation = autoEstimation => {
        if (editing) setTaskAutoEstimation(projectId, task, autoEstimation)
        setTempAutoEstimation(autoEstimation)
    }

    return (
        <Popover
            content={
                <EstimationModal
                    projectId={projectId}
                    estimation={currentEstimation}
                    setEstimationFn={setEstimationFn}
                    closePopover={closePopover}
                    autoEstimation={getTaskAutoEstimation(projectId, currentEstimation, task.autoEstimation)}
                    setAutoEstimation={setAutoEstimation}
                    showAutoEstimation={!task.isSubtask}
                    disabled={!!task.calendarData}
                />
            }
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <Hotkeys
                keyName={`alt+${shortcutText}`}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(buttonRef, showPopover, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (buttonRef = ref)}
                    title={smallScreen ? null : translate('Estimation')}
                    type={'ghost'}
                    noBorder={smallScreen}
                    icon={`count-circle-${getEstimationIconByValue(projectId, currentEstimation)}`}
                    buttonStyle={style}
                    onPress={showPopover}
                    disabled={disabled}
                    shortcutText={shortcutText}
                />
            </Hotkeys>
        </Popover>
    )
}
