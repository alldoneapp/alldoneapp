import React, { useState } from 'react'
import AppPopover from '../ModalShell/AppPopover'
import Button from '../../UIControls/Button'
import CopyProjectModal from '../../ProjectDetailedView/ProjectProperties/CopyProject/CopyProjectModal'
import { translate } from '../../../i18n/TranslationService'

const CopyProjectButton = ({ project, hidePopup }) => {
    const [isOpen, setIsOpen] = useState(false)

    const closeModal = () => {
        setIsOpen(false)
        hidePopup?.()
    }

    return (
        <AppPopover
            isOpen={isOpen}
            onClickOutside={() => setIsOpen(false)}
            align={'end'}
            position={'top'}
            content={<CopyProjectModal setIsOpen={closeModal} project={project} />}
            padding={8}
        >
            <Button title={translate('Duplicate Project')} type={'primary'} onPress={() => setIsOpen(!isOpen)} />
        </AppPopover>
    )
}

export default CopyProjectButton
