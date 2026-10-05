import React, { useRef } from 'react'

import ModalItem from '../MorePopupsOfEditModals/Common/ModalItem'
import { startMeetingPreparation } from '../../../../utils/meetingPreparation'

export default function PrepareMeetingsItem({ projectId, tasks, specificTask = false, shortcut, closeModal }) {
    const starting = useRef(false)

    const prepare = async event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        if (starting.current) return
        starting.current = true
        closeModal?.()
        try {
            await startMeetingPreparation({ projectId, tasks, specificTask })
        } finally {
            starting.current = false
        }
    }

    return <ModalItem icon="calendar" text="Prepare meetings" shortcut={shortcut} onPress={prepare} />
}
