import React from 'react'
import ModalItem from '../Common/ModalItem'
import { Keyboard } from 'react-native'
import { storeModal } from '../../../../ModalsManager/modalsManager'
import { showFloatPopup } from '../../../../../redux/actions'
import { useDispatch } from 'react-redux'

export default function GoalModalItem({ icon, text, shortcut, modalConstant, visibilityFn }) {
    const dispatch = useDispatch()

    const openModal = e => {
        e?.preventDefault()
        e?.stopPropagation()
        Keyboard.dismiss()
        if (modalConstant) storeModal(modalConstant)
        dispatch(showFloatPopup())
        visibilityFn(true)
    }

    return <ModalItem icon={icon} text={text} shortcut={shortcut} onPress={openModal} />
}
