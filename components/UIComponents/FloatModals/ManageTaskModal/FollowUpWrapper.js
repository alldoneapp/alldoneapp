import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { useDispatch } from 'react-redux'

import { colors } from '../../../styles/global'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'
import FollowUpDueDate from '../../../FollowUp/FollowUpDueDate'
import CustomFollowUpDateModal from '../../../FollowUp/CustomFollowUpDateModal'
import Button from '../../../UIControls/Button'
import { setLastSelectedDueDate } from '../../../../redux/actions'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'

export default function FollowUpWrapper({ createFollowUpTask, task }) {
    const dispatch = useDispatch()
    const [isDueDateOpen, setIsDueDateOpen] = useState(false)
    const [isCalendarOpen, setIsCalendarOpen] = useState(false)

    const openDueDateModal = () => {
        setIsDueDateOpen(true)
    }

    const closeDueDateModal = () => {
        setIsDueDateOpen(false)
    }

    const openCalenadarModal = () => {
        closeDueDateModal()
        setIsCalendarOpen(true)
    }

    const closeCalenadarModal = () => {
        openDueDateModal()
        setIsCalendarOpen(false)
    }

    const closeModals = () => {
        setIsDueDateOpen(false)
        setIsCalendarOpen(false)
    }

    const selectFollowUpDate = (dateText, date, isCustom) => {
        if (date === BACKLOG_DATE_NUMERIC) {
            selectBacklog(dateText, date)
        } else {
            dispatch(setLastSelectedDueDate(date.valueOf()))
            createFollowUpTask(date)
            closeModals()
        }
    }

    const selectBacklog = (dateText, date) => {
        dispatch(setLastSelectedDueDate(Number.MAX_SAFE_INTEGER))
        createFollowUpTask(date, true)
        closeModals()
    }

    const cleanedName = task.extendedName.trim()
    return (
        <Popover
            content={
                isDueDateOpen ? (
                    <FollowUpDueDate
                        closePopover={closeModals}
                        onCustomDatePress={openCalenadarModal}
                        selectDate={selectFollowUpDate}
                        selectBacklog={selectBacklog}
                        directFollowUp={true}
                    />
                ) : isCalendarOpen ? (
                    <CustomFollowUpDateModal
                        hidePopover={closeCalenadarModal}
                        selectDate={selectFollowUpDate}
                        backToDueDate={closeCalenadarModal}
                    />
                ) : null
            }
            align={'end'}
            position={['right']}
            onClickOutside={closeModals}
            isOpen={isDueDateOpen || isCalendarOpen}
        >
            <Hotkeys
                keyName={'alt+l'}
                onKeyDown={(sht, event) => execShortcutFn(this.followUpBtnRef, openDueDateModal, event)}
                filter={e => true}
                disabled={!cleanedName}
            >
                <Button
                    ref={ref => (this.followUpBtnRef = ref)}
                    icon={'calendar-up'}
                    iconColor={colors.Text04}
                    buttonStyle={{ backgroundColor: 'transparent', marginRight: 4 }}
                    onPress={openDueDateModal}
                    shortcutText={'L'}
                    forceShowShortcut={true}
                    disabled={!cleanedName}
                />
            </Hotkeys>
        </Popover>
    )
}
