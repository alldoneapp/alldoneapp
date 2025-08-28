import React from 'react'
import { useDispatch } from 'react-redux'

import { setActiveDragSkillModeId } from '../../../../../../redux/actions'
import ModalItem from '../../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem'

export default function OrganizeModalItem({ shortcut, onPress, projectId }) {
    const dispatch = useDispatch()

    const activeDragMode = e => {
        e?.preventDefault()
        e?.stopPropagation()
        dispatch(setActiveDragSkillModeId(projectId))
        onPress()
    }

    return <ModalItem icon={'multi-selection'} text={'Organize'} shortcut={shortcut} onPress={activeDragMode} />
}
