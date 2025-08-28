import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import AssigneesIcon from './AssigneesIcon'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { GOAL_ASSIGNEES_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import GoalAssigneesModal from '../../UIComponents/FloatModals/GoalAssigneesModal/GoalAssigneesModal'
import { translate } from '../../../i18n/TranslationService'

export default function AssigneesWrapper({
    goal,
    updateAssignees,
    projectId,
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

    const { assigneesIds, assigneesCapacity } = goal
    const isSmallButton = inMentionModal || (smallScreen && !inDetailedView)

    const buttonCustomIcon =
        assigneesIds.length > 0 ? (
            <AssigneesIcon assigneesIds={assigneesIds} disableModal={true} projectId={projectId} />
        ) : undefined

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(GOAL_ASSIGNEES_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        removeModal(GOAL_ASSIGNEES_MODAL_ID)
    }

    const selectAssignees = (assigneesIds, assigneesCapacity) => {
        setTimeout(() => {
            closeModal()
            updateAssignees(assigneesIds, assigneesCapacity)
        })
    }

    return (
        <Popover
            content={
                <GoalAssigneesModal
                    closeModal={closeModal}
                    updateAssignees={selectAssignees}
                    initialSelectedAssigeesIds={assigneesIds}
                    projectId={projectId}
                    initialSelectedAssigeesCapacity={assigneesCapacity}
                />
            }
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            align={'end'}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+A'}
                disabled={disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.assigneesBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.assigneesBtnRef = ref)}
                    title={isSmallButton ? null : translate('Assign')}
                    type={'ghost'}
                    noBorder={isSmallButton}
                    icon={assigneesIds.length === 0 ? 'users' : undefined}
                    buttonStyle={[
                        inMentionModal ? { marginRight: 4 } : { marginHorizontal: smallScreen ? 4 : 2 },
                        buttonStyle,
                    ]}
                    onPress={openModal}
                    disabled={isOpen || disabled}
                    customIcon={buttonCustomIcon}
                    shortcutText={'A'}
                />
            </Hotkeys>
        </Popover>
    )
}
