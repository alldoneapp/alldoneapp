import React from 'react'
import { useSelector } from 'react-redux'

import { checkIfCalendarConnected } from '../../../../../utils/backends/firestore'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'

export default function SyncCalendarModalItem({ onPress, shortcut }) {
    const { selectedProjectIndex, loggedUserProjects, loggedUser } = useSelector(state => state)
    const projectId = loggedUserProjects[selectedProjectIndex]?.id

    const sync = () => {
        if (projectId) {
            checkIfCalendarConnected(projectId)
        } else if (loggedUser?.apisConnected) {
            Object.entries(loggedUser.apisConnected).forEach(([pid, flags]) => {
                if (flags?.calendar) checkIfCalendarConnected(pid)
            })
        }
        onPress?.()
    }

    return <ModalItem icon={'refresh-cw'} text={'Sync calendar'} shortcut={shortcut} onPress={sync} />
}
