import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import ModalItem from '../../MorePopupsOfEditModals/Common/ModalItem'
import Line from '../../GoalMilestoneModal/Line'
import { setSelectedNavItem } from '../../../../../redux/actions'
import NavigationService from '../../../../../utils/NavigationService'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../../../utils/TabNavigationConstants'

export default function OpenProjectModalItem({ projectId, shortcut = '1', onPress }) {
    const dispatch = useDispatch()
    const projectIndex = useSelector(state => state.loggedUserProjectsMap?.[projectId]?.index)

    const openProject = () => {
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
        NavigationService.navigate('ProjectDetailedView', { projectIndex })
        onPress?.()
    }

    return (
        <>
            <ModalItem icon={'folder-open'} text={'Open Project'} shortcut={shortcut} onPress={openProject} />
            <Line />
        </>
    )
}
