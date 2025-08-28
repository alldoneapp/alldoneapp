import React, { useEffect } from 'react'
import Button from '../../UIControls/Button'
import { COMMENT_MODAL_ID, exitsOpenModals, TAGS_EDIT_OBJECT_MODAL_ID } from '../../ModalsManager/modalsManager'

export default function SaveButton({ icon, onPress, disabled }) {
    const onPressEnter = e => {
        if (e.key === 'Enter' && !exitsOpenModals([COMMENT_MODAL_ID, TAGS_EDIT_OBJECT_MODAL_ID])) {
            e?.preventDefault()
            e?.stopPropagation()
            onPress?.()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onPressEnter)
        return () => document.removeEventListener('keydown', onPressEnter)
    })

    return (
        <Button
            icon={icon || 'save'}
            iconColor={'#ffffff'}
            type={'primary'}
            onPress={onPress}
            shortcutText={'Enter'}
            forceShowShortcut={true}
            disabled={disabled}
        />
    )
}
