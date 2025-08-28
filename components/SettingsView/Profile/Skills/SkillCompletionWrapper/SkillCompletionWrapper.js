import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import {
    storeModal,
    removeModal,
    MENTION_MODAL_ID,
    SKILL_COMPLETION_MODAL_ID,
} from '../../../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import SkillCompletionModal from './SkillCompletionModal'
import SkillCompletionTag from '../../../../Tags/SkillCompletionTag'
import CompletionButton from './CompletionButton'
import { updateSkillCompletion } from '../../../../../utils/backends/Skills/skillsFirestore'

export default function SkillCompletionWrapper({ skill, projectId, disabled, inDv }) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(SKILL_COMPLETION_MODAL_ID)
    }

    const closeModal = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            setIsOpen(false)
            dispatch(hideFloatPopup())
            removeModal(SKILL_COMPLETION_MODAL_ID)
        }
    }

    const changeCompletion = completion => {
        closeModal()
        if (completion !== skill.completion) updateSkillCompletion(projectId, completion, skill)
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <SkillCompletionModal
                    closeModal={closeModal}
                    changeCompletion={changeCompletion}
                    completion={skill.completion}
                    projectId={projectId}
                    skillId={skill.id}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            {inDv ? (
                <CompletionButton completion={skill.completion} onPress={openModal} disabled={disabled} />
            ) : (
                <SkillCompletionTag
                    completion={skill.completion}
                    style={{ marginLeft: 8 }}
                    onPress={openModal}
                    disabled={disabled}
                />
            )}
        </Popover>
    )
}
