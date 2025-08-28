import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import { colors } from '../../../styles/global'
import DueDateModal from '../DueDateModal/DueDateModal'
import Button from '../../../UIControls/Button'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'

export default function DueDateWrapper({ task, projectId, setDueDate, setToBacklog, disabled = false }) {
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const selectDueDate = (taskFromModal, actualDate, isObservedFromModal) => {
        closeModal()
        setDueDate(actualDate)
    }

    const selectBacklog = () => {
        closeModal()
        setToBacklog?.()
    }

    const cleanedName = task.extendedName.trim()
    return (
        <Popover
            content={
                <DueDateModal
                    task={task}
                    projectId={projectId}
                    closePopover={closeModal}
                    delayClosePopover={closeModal}
                    saveDueDateBeforeSaveTask={selectDueDate}
                    setToBacklogBeforeSaveTask={selectBacklog}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <Hotkeys
                keyName={'alt+r'}
                onKeyDown={(sht, event) => execShortcutFn(this.dateBtnRef, openModal, event)}
                filter={e => true}
                disabled={disabled || !cleanedName}
            >
                <Button
                    ref={ref => (this.dateBtnRef = ref)}
                    icon={'calendar'}
                    iconColor={colors.Text04}
                    buttonStyle={{ backgroundColor: 'transparent', marginRight: 4 }}
                    onPress={openModal}
                    shortcutText={'R'}
                    forceShowShortcut={true}
                    disabled={disabled || !cleanedName}
                />
            </Hotkeys>
        </Popover>
    )
}
