import React, { useRef, useState } from 'react'
import Popover from 'react-tiny-popover'

import Button from '../../UIControls/Button'
import SelectProjectModal from '../../UIComponents/FloatModals/SelectProjectModal/SelectProjectModal'

import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'

export default function ProjectPicker({ project, item, disabled }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const buttonRef = useRef()
    const name = project?.name ? project.name : translate('Project')
    const color = project?.color ? project.color : '#06EEC1'

    const [showPopup, setShowPopup] = useState(false)

    const closePopover = () => {
        setShowPopup(false)
    }

    const openPopover = () => {
        setShowPopup(true)
        buttonRef?.current?.blur()
    }

    return (
        <Popover
            containerStyle={{ maxHeight: 400 }}
            content={showPopup && <SelectProjectModal item={item} project={project} closePopover={closePopover} />}
            onClickOutside={closePopover}
            isOpen={showPopup}
            position={['left', 'bottom', 'right', 'top']}
            align={'end'}
            padding={4}
        >
            <Button
                ref={buttonRef}
                type={'ghost'}
                title={shrinkTagText(name)}
                color={color}
                onPress={openPopover}
                buttonStyle={{ maxWidth: 240 }}
                disabled={disabled}
            />
        </Popover>
    )
}
