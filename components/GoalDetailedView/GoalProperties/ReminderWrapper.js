import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import moment from 'moment'

import Button from '../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import {} from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { DUE_DATE_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import DueDateModal from '../../UIComponents/FloatModals/DueDateModal/DueDateModal'
import { translate } from '../../../i18n/TranslationService'
import { BACKLOG_DATE_NUMERIC } from '../../TaskListView/Utils/TasksHelper'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'

export default function ReminderWrapper({ projectId, updateReminder, reminderDate, disabled, goal }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(DUE_DATE_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        setTimeout(() => {
            removeModal(DUE_DATE_MODAL_ID)
        }, 400)
    }

    const getButtonText = () => {
        return reminderDate
            ? reminderDate === BACKLOG_DATE_NUMERIC
                ? translate('Someday')
                : moment(reminderDate).format(getDateFormat())
            : translate('None')
    }

    const firstTask = { dueDate: reminderDate ? reminderDate : moment().valueOf() }
    return (
        <Popover
            content={
                <DueDateModal
                    projectId={projectId}
                    task={firstTask}
                    closePopover={closeModal}
                    delayClosePopover={closeModal}
                    tasks={[]}
                    updateParentGoalReminderDate={updateReminder}
                    goalCompletionDate={goal.completionMilestoneDate}
                    goalStartingDate={goal.startingMilestoneDate}
                    goal={goal}
                />
            }
            align={'start'}
            position={['left']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+D'}
                disabled={disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.reminderBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.reminderBtnRef = ref)}
                    title={getButtonText()}
                    type={'ghost'}
                    icon={'calendar'}
                    buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'D'}
                />
            </Hotkeys>
        </Popover>
    )
}
