import React, { useEffect } from 'react'
import Button from '../../UIControls/Button'
import { useSelector } from 'react-redux'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../ModalsManager/modalsManager'

export default function PlusButton({ onPress, disabled, modalId, processing }) {
    const mentionModalStack = useSelector(state => state.mentionModalStack)

    const onPressEnter = e => {
        if (disabled || processing) return
        // Holding Return down repeats the keydown event, and an IME commit
        // reports its own Enter. Neither is a second intended submission.
        if (e.repeat || e.isComposing || e.keyCode === 229) return

        if (
            e.key === 'Enter' &&
            mentionModalStack[0] === modalId &&
            !exitsOpenModals([MENTION_MODAL_ID, COMMENT_MODAL_ID, TAGS_INTERACTION_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID])
        ) {
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
            icon={processing ? '' : 'plus'}
            iconColor={'#ffffff'}
            type={'primary'}
            onPress={onPress}
            shortcutText={processing ? '' : 'Enter'}
            forceShowShortcut={!processing}
            disabled={disabled || processing}
            processing={processing}
        />
    )
}
