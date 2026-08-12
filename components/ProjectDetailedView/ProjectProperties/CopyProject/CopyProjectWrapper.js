import React, { useState } from 'react'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import Button from '../../../UIControls/Button'
import CopyProjectModal from './CopyProjectModal'
import { translate } from '../../../../i18n/TranslationService'

const CopyProjectWrapper = ({ project, disabled }) => {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <AppPopover
            isOpen={isOpen}
            onClickOutside={() => setIsOpen(false)}
            align={'end'}
            position={'top'}
            content={<CopyProjectModal setIsOpen={setIsOpen} project={project} />}
            padding={8}
        >
            <Button
                title={translate('Duplicate Project')}
                icon={'copy'}
                type="ghost"
                disabled={disabled}
                onPress={() => setIsOpen(!isOpen)}
                buttonStyle={{ marginTop: 16 }}
            />
        </AppPopover>
    )
}

export default CopyProjectWrapper
