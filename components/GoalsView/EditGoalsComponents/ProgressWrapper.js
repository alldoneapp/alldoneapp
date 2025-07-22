import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import GoalsProgressModal from '../../UIComponents/FloatModals/GoalsProgressModal/GoalsProgressModal'
import ProgressIcon from './ProgressIcon'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { storeModal, removeModal, GOAL_PROGRESS_MODAL_ID, MENTION_MODAL_ID } from '../../ModalsManager/modalsManager'
import { checkIsLimitedByXp } from '../../Premium/PremiumHelper'

export default function ProgressWrapper({
    goal,
    updateProgress,
    buttonStyle,
    inDetailedView,
    disabled,
    inMentionModal,
    projectId,
    closeParentModal,
}) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { progress, dynamicProgress } = goal
    const isSmallButton = inMentionModal || (smallScreen && !inDetailedView)

    const buttonCustomIcon = (
        <ProgressIcon progress={progress} dynamicProgress={dynamicProgress} projectId={projectId} inGoal={true} />
    )

    const openModal = () => {
        if (checkIsLimitedByXp(projectId)) {
            if (closeParentModal) closeParentModal()
        } else {
            setIsOpen(true)
            dispatch(showFloatPopup())
            storeModal(GOAL_PROGRESS_MODAL_ID)
        }
    }

    const closeModal = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            setIsOpen(false)
            dispatch(hideFloatPopup())
            removeModal(GOAL_PROGRESS_MODAL_ID)
        }
    }

    const selectProgress = (progress, addedComment) => {
        setTimeout(() => {
            closeModal()
            updateProgress(progress, addedComment)
        })
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <GoalsProgressModal
                    closeModal={closeModal}
                    updateProgress={selectProgress}
                    progress={progress}
                    projectId={projectId}
                    goal={goal}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+P'}
                disabled={disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.progressBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.progressBtnRef = ref)}
                    title={isSmallButton ? null : 'Progress'}
                    type={'ghost'}
                    noBorder={isSmallButton}
                    buttonStyle={[
                        inMentionModal ? { marginRight: 4 } : { marginHorizontal: smallScreen ? 4 : 2 },
                        buttonStyle,
                    ]}
                    onPress={openModal}
                    disabled={disabled}
                    customIcon={buttonCustomIcon}
                    shortcutText={'P'}
                />
            </Hotkeys>
        </Popover>
    )
}
