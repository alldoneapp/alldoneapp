import React from 'react'
import ModalItem from './ModalItem'

export default function GenericModalItem({ icon, text, shortcut, visibilityData }) {
    const openModal = e => {
        const { openPopup, constant, visibilityFn } = visibilityData
        openPopup(e, constant, visibilityFn)
    }

    return <ModalItem icon={icon} text={text} shortcut={shortcut} onPress={openModal} />
}
