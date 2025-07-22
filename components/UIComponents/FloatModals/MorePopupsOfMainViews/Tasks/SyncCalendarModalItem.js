import React from 'react'
import { useSelector } from 'react-redux'

import { checkIfCalendarConnected } from '../../../../../utils/backends/firestore'
import { getProjectIdWhereCalendarIsConnected } from '../../../../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'

export default function SyncCalendarModalItem({ onPress, shortcut }) {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)

    const projectIdWhereCalendarIsConnected = getProjectIdWhereCalendarIsConnected(apisConnected)

    const sync = () => {
        checkIfCalendarConnected(projectIdWhereCalendarIsConnected)
        onPress?.()
    }

    return <ModalItem icon={'refresh-cw'} text={'Sync calendar'} shortcut={shortcut} onPress={sync} />
}
