import React from 'react'

import store from '../../../../../redux/store'
import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import { sortGoalsAlphabetically } from '../../../../../utils/backends/Goals/goalsFirestore'

export default function SortAlphabeticallyItem({ projectId, milestoneId, shortcut, goals, onPress }) {
    const sortGoals = e => {
        e?.preventDefault()
        e?.stopPropagation()
        sortGoalsAlphabetically(projectId, milestoneId, goals)
        onPress()
    }

    return <ModalItem icon={'sort-list'} text={'Sort goals alphabetically'} shortcut={shortcut} onPress={sortGoals} />
}
