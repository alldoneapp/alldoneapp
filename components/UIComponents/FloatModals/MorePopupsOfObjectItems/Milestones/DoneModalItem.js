import React, { useEffect } from 'react'
import { useSelector } from 'react-redux'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'

export default function DoneModalItem({ milestone, firstMilestoneId, shortcut, onPress }) {
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const milestoneInEditionId = useSelector(state => state.milestoneInEditionId)
    const goalInEditionMilestoneId = useSelector(state => state.goalInEditionMilestoneId)

    const onKeyDown = event => {
        if (blockShortcuts) {
            return
        }
        const { key, altKey, shiftKey } = event
        if (altKey && shiftKey && (key === 'D' || key === 'd')) {
            const enableShorcut =
                !milestoneInEditionId &&
                ((!goalInEditionMilestoneId && firstMilestoneId === milestone.id) ||
                    goalInEditionMilestoneId === milestone.id)
            if (enableShorcut) {
                onPress()
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <ModalItem
            key={'mmbtn-done'}
            icon={milestone.done ? 'square' : 'square-checked-gray'}
            text={`Mark milestone as ${milestone.done ? 'open' : 'done'}`}
            shortcut={shortcut}
            onPress={onPress}
        />
    )
}
