import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import {} from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { DUE_DATE_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import DueDateModal from '../../UIComponents/FloatModals/DueDateModal/DueDateModal'
import { translate } from '../../../i18n/TranslationService'

export default function ReminderWrapper({
    projectId,
    areObservedTask,
    extendedName,
    parentGoaltasks,
    inParentGoal,
    updateReminder,
    goal,
    isEmptyGoal,
}) {
    const dispatch = useDispatch()
    const currentUser = useSelector(state => state.currentUser)
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
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

    const cleanedName = extendedName.trim()
    const firstTask = isEmptyGoal ? { dueDate: goal.assigneesReminderDate[currentUser.uid] } : parentGoaltasks[0]
    return (
        <Popover
            content={
                <DueDateModal
                    projectId={projectId}
                    task={firstTask}
                    closePopover={closeModal}
                    delayClosePopover={closeModal}
                    multipleTasks={!isEmptyGoal}
                    tasks={isEmptyGoal ? [] : parentGoaltasks}
                    isObservedTask={areObservedTask}
                    inParentGoal={inParentGoal}
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
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+R'}
                disabled={!cleanedName || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.milestoneBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.milestoneBtnRef = ref)}
                    title={smallScreen ? null : translate('Reminder')}
                    type={'ghost'}
                    noBorder={smallScreen}
                    icon={'calendar'}
                    buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                    onPress={openModal}
                    disabled={!cleanedName}
                    shortcutText={'R'}
                />
            </Hotkeys>
        </Popover>
    )
}
