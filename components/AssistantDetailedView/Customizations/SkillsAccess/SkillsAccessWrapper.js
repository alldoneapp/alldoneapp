import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { translate } from '../../../../i18n/TranslationService'
import AssistantSkillsModal from '../../../UIComponents/FloatModals/AssistantSkillsModal/AssistantSkillsModal'
import { updateAssistantEnabledSkills } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { getGlobalAssistantSkills } from '../../../../utils/backends/AssistantSkills/assistantSkillsFirestore'
import { normalizeEnabledSkillIds } from '../../../AdminPanel/AssistantSkills/assistantSkillsHelper'

export default function SkillsAccessWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)

    const [isOpen, setIsOpen] = useState(false)
    const [skills, setSkills] = useState([])
    const isOpenRef = useRef(false)

    const enabledSkillIds = normalizeEnabledSkillIds(assistant.enabledSkillIds)

    useEffect(() => {
        let mounted = true
        getGlobalAssistantSkills().then(catalogSkills => {
            if (mounted) setSkills(catalogSkills.filter(skill => skill.enabled !== false))
        })
        return () => {
            mounted = false
        }
    }, [])

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    useEffect(() => {
        isOpenRef.current = isOpen
    }, [isOpen])

    useEffect(() => {
        return () => {
            if (isOpenRef.current) dispatch(hideFloatPopup())
        }
    }, [])

    const applySkills = skillIds => {
        updateAssistantEnabledSkills(projectId, assistant, skillIds)
    }

    const buttonLabel = `${translate('Edit')} (${enabledSkillIds.length}/${skills.length})`

    return (
        <Popover
            content={
                <AssistantSkillsModal
                    skills={skills}
                    enabledSkillIds={enabledSkillIds}
                    onApply={applySkills}
                    closeModal={closeModal}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Button
                type={'ghost'}
                icon={'edit-2'}
                onPress={openModal}
                disabled={isOpen || disabled}
                title={buttonLabel}
            />
        </Popover>
    )
}
