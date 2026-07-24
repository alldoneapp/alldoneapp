import React from 'react'
import ModalItem from '../../../../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem'

export default function OptionItem({ shortcut, icon, text, notTranslatedText, action }) {
    const onPress = e => {
        e?.preventDefault()
        e?.stopPropagation()
        action()
    }

    return (
        <ModalItem
            icon={icon}
            notTranslatedText={notTranslatedText}
            text={text}
            shortcut={shortcut}
            onPress={onPress}
        />
    )
}
