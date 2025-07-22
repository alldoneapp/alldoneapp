import React from 'react'
import { useSelector } from 'react-redux'

import AmountBadge from '../Common/AmountBadge'

export default function RightAreaAmount({ projectId, highlight }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const sidebarNumbersInProject = useSelector(state => state.sidebarNumbers[projectId])

    const amountOpenTasks = sidebarNumbersInProject
        ? sidebarNumbersInProject[loggedUserId] > 0
            ? sidebarNumbersInProject[loggedUserId]
            : ''
        : ''

    return <AmountBadge amount={amountOpenTasks} active={highlight} />
}
