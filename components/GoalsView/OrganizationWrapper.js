import React, { useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'
import Hotkeys from 'react-hot-keys'

import Button from '../UIControls/Button'
import GoalOrganizationModal from '../UIComponents/FloatModals/GoalOrganizationModal'
import GoalMilestoneModal from '../UIComponents/FloatModals/GoalMilestoneModal/GoalMilestoneModal'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import { execShortcutFn } from '../UIComponents/ShortcutCheatSheet/HelperFunctions'

export default function OrganizationWrapper({
    projectId,
    updateDate,
    updateThisAndLaterMilestones,
    milestone,
    disabled,
}) {
    const ORGANIZATION_MODAL_IS_OPEN = 0
    const MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE = 1
    const MILESTONE_MODAL_IS_OPEN_IN_THIS_MILESTONE_AND_LATER_MODE = 2
    const MODALS_ARE_CLOSED = 3

    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [modalsState, setModalsState] = useState(MODALS_ARE_CLOSED)

    const openOrganizationModal = () => {
        if (modalsState === MODALS_ARE_CLOSED) {
            dispatch(showFloatPopup())
        }
        setModalsState(ORGANIZATION_MODAL_IS_OPEN)
    }

    const openMilestoneModalInOnlyThisMilestoneMode = () => {
        setModalsState(MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE)
    }

    const openMilestoneModalInOnlyThisMilestoneAndLaterMode = () => {
        setModalsState(MILESTONE_MODAL_IS_OPEN_IN_THIS_MILESTONE_AND_LATER_MODE)
    }

    const closeModal = () => {
        setModalsState(MODALS_ARE_CLOSED)
        dispatch(hideFloatPopup())
    }

    const selectMilestone = milestone => {
        this.setTimeout(() => {
            closeModal()
            updateDate(milestone)
        })
    }

    const selectMilestoneForThisAndLater = milestone => {
        this.setTimeout(() => {
            closeModal()
            updateThisAndLaterMilestones(milestone)
        })
    }

    const title = smallScreen ? null : moment(milestone.date).format(getDateFormat())
    return (
        <Popover
            content={
                modalsState === ORGANIZATION_MODAL_IS_OPEN ? (
                    <GoalOrganizationModal
                        closeModal={closeModal}
                        organizeOnlyThisMilestoneGoals={openMilestoneModalInOnlyThisMilestoneMode}
                        organizeOnlyThisAndLaterMilestonesGoals={openMilestoneModalInOnlyThisMilestoneAndLaterMode}
                    />
                ) : modalsState === MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE ||
                  modalsState === MILESTONE_MODAL_IS_OPEN_IN_THIS_MILESTONE_AND_LATER_MODE ? (
                    <GoalMilestoneModal
                        projectId={projectId}
                        closeModal={closeModal}
                        updateMilestone={
                            modalsState === MILESTONE_MODAL_IS_OPEN_IN_ONLY_THIS_MILESTONE_MODE
                                ? selectMilestone
                                : selectMilestoneForThisAndLater
                        }
                        milestoneDate={milestone.date}
                        openOrganizationModal={openOrganizationModal}
                        ownerId={milestone.ownerId}
                    />
                ) : (
                    <View />
                )
            }
            align={'start'}
            position={['left']}
            onClickOutside={closeModal}
            isOpen={modalsState !== MODALS_ARE_CLOSED}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+R'}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.milestoneBtnRef, openOrganizationModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.milestoneBtnRef = ref)}
                    title={title}
                    type={'ghost'}
                    noBorder={smallScreen}
                    icon={'calendar'}
                    buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                    onPress={openOrganizationModal}
                    disabled={disabled}
                    shortcutText={'R'}
                />
            </Hotkeys>
        </Popover>
    )
}
