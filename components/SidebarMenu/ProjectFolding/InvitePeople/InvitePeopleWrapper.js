import React from 'react'
import { useDispatch } from 'react-redux'

import InvitePeopleButton from './InvitePeopleButton'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../../utils/TabNavigationConstants'

export default function InvitePeopleWrapper({ projectColor, projectIndex }) {
    const dispatch = useDispatch()

    const openProjectSettings = () => {
        NavigationService.navigate('ProjectDetailedView', {
            projectIndex,
        })
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
    }

    return <InvitePeopleButton projectColor={projectColor} openProjectSettings={openProjectSettings} />
}
