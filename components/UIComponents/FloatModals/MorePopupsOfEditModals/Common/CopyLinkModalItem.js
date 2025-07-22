import React from 'react'
import ModalItem from './ModalItem'
import { copyTextToClipboard } from '../../../../../utils/HelperFunctions'

export default function CopyLinkModalItem({ link, onPress, shortcut }) {
    const copyLink = () => {
        copyTextToClipboard(link)
        onPress?.()
    }

    return <ModalItem icon={'link'} text={'Copy link'} shortcut={shortcut} onPress={copyLink} />
}
