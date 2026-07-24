import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import Backend from '../../../../../utils/BackendBridge'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import {
    storeModal,
    removeModal,
    MENTION_MODAL_ID,
    SKILL_POINTS_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import SkillPointButton from './SkillPointButton'
import SkillPointsModal from './SkillPointsModal'
import SkillPointButtonInEditionMode from './SkillPointButtonInEditionMode'
import Button from '../../../../UIControls/Button'

export default function SkillPointsWrapper({
    skill,
    projectId,
    disabled,
    updateSkillPoints,
    points,
    buttonStyle,
    inButtonsArea,
    inDetailedView,
    inEditModal,
}) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const isMentionModalOpen = useSelector(state => state.openModals[MENTION_MODAL_ID])
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(SKILL_POINTS_MODAL_ID)
    }

    const closeModal = () => {
        if (!isQuillTagEditorOpen && !isMentionModalOpen) {
            setIsOpen(false)
            dispatch(hideFloatPopup())
            removeModal(SKILL_POINTS_MODAL_ID)
        }
    }

    const changeSkillPoints = pointsToAdd => {
        setTimeout(() => {
            closeModal()
            updateSkillPoints
                ? updateSkillPoints(pointsToAdd)
                : Backend.updateSkillPoints(projectId, skill, pointsToAdd)
        })
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <SkillPointsModal
                    projectId={projectId}
                    skillId={skill.id}
                    points={points}
                    changeSkillPoints={changeSkillPoints}
                    closeModal={closeModal}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            {inButtonsArea ? (
                <SkillPointButtonInEditionMode
                    disabled={disabled}
                    shortcutText={'S'}
                    onPress={openModal}
                    inEditModal={inEditModal}
                />
            ) : inDetailedView ? (
                <Button icon="trending-up" type={'ghost'} title={points} onPress={openModal} disabled={disabled} />
            ) : (
                <SkillPointButton
                    onPress={openModal}
                    points={points}
                    containerStyle={buttonStyle}
                    disabled={disabled}
                />
            )}
        </Popover>
    )
}
