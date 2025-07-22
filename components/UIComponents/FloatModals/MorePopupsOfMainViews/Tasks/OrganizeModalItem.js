import React, { useEffect } from 'react'
import { setActiveDragGoalMode } from '../../../../../redux/actions'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { useDispatch } from 'react-redux'

export default function OrganizeModalItem({ shortcut, onPress, parentObjectId }) {
    const dispatch = useDispatch()

    const activeDragMode = e => {
        e?.preventDefault()
        e?.stopPropagation()

        dispatch(setActiveDragGoalMode(parentObjectId))
        onPress()
    }

    useEffect(() => {
        dispatch(setActiveDragGoalMode(false))
    }, [])

    return <ModalItem icon={'multi-selection'} text={'Organize'} shortcut={shortcut} onPress={activeDragMode} />
}
