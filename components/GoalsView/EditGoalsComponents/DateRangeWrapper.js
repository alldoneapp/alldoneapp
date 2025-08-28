import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import GoalMilestoneRangeModal from '../../UIComponents/FloatModals/GoalMilestoneRangeModal/GoalMilestoneRangeModal'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { GOAL_DATE_RANGE_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import { BACKLOG_DATE_NUMERIC } from '../../TaskListView/Utils/TasksHelper'
import { translate } from '../../../i18n/TranslationService'

export default function DateRangeWrapper({
    projectId,
    updateDateRange,
    goal,
    buttonStyle,
    inDetailedView,
    inMentionModal,
    disabled,
}) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { startingMilestoneDate, completionMilestoneDate } = goal
    const isSmallButton = inMentionModal || (smallScreen && !inDetailedView)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(GOAL_DATE_RANGE_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        removeModal(GOAL_DATE_RANGE_MODAL_ID)
    }

    const updateMilestoneDateRange = (date, rangeEdgePropertyName) => {
        this.setTimeout(() => {
            closeModal()
            updateDateRange(date, rangeEdgePropertyName)
        })
    }

    const getButtonText = () => {
        return completionMilestoneDate === BACKLOG_DATE_NUMERIC
            ? translate('Someday')
            : moment(completionMilestoneDate).format(getDateFormat())
    }

    return (
        <Popover
            content={
                <GoalMilestoneRangeModal
                    projectId={projectId}
                    closeModal={closeModal}
                    updateMilestoneDateRange={updateMilestoneDateRange}
                    startingMilestoneDate={startingMilestoneDate}
                    completionMilestoneDate={completionMilestoneDate}
                    ownerId={goal.ownerId}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+R'}
                disabled={disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.milestoneBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.milestoneBtnRef = ref)}
                    title={isSmallButton ? null : getButtonText()}
                    type={'ghost'}
                    noBorder={isSmallButton}
                    icon={'calendar'}
                    buttonStyle={[
                        inMentionModal ? { marginRight: 4 } : { marginHorizontal: smallScreen ? 4 : 2 },
                        buttonStyle,
                    ]}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'R'}
                />
            </Hotkeys>
        </Popover>
    )
}
