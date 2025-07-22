import React from 'react'
import { useDispatch } from 'react-redux'

import { setActiveDragTaskModeInMyDay } from '../../../redux/actions'
import ModalItem from '../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem'

export default function OrganizeModalItem({ shortcut, onPress }) {
    const dispatch = useDispatch()

    const activeDragMode = e => {
        e?.preventDefault()
        e?.stopPropagation()
        dispatch(setActiveDragTaskModeInMyDay(true))
        onPress()
    }

    return <ModalItem icon={'multi-selection'} text={'Organize'} shortcut={shortcut} onPress={activeDragMode} />
}
