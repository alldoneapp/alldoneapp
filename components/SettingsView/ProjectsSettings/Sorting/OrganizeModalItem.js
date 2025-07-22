import React from 'react'
import { useDispatch } from 'react-redux'

import { setActiveDragProjectModeType } from '../../../../redux/actions'
import ModalItem from '../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem'

export default function OrganizeModalItem({ shortcut, onPress, projectType }) {
    const dispatch = useDispatch()

    const activeDragMode = e => {
        e?.preventDefault()
        e?.stopPropagation()
        dispatch(setActiveDragProjectModeType(projectType))
        onPress()
    }

    return <ModalItem icon={'multi-selection'} text={'Organize'} shortcut={shortcut} onPress={activeDragMode} />
}
