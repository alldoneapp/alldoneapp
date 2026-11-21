import React from 'react'
import { useDispatch } from 'react-redux'

import store from '../../../../redux/store'
import { hideWebSideBar, setSelectedNavItem } from '../../../../redux/actions'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import NavigationService from '../../../../utils/NavigationService'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../../utils/TabNavigationConstants'
import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'

/**
 * AT-3121: the project's settings as the last row of its sections in the "Anna on top" sidebar, which
 * has no people list (and so no settings row under it, InvitePeopleWrapper). Opens the same screen.
 */
export default function ProjectSettings({ projectIndex, projectColor, selected }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        dismissAllPopups(true, true, true)
        const actions = [setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES)]
        if (store.getState().smallScreenNavigation) actions.push(hideWebSideBar())
        NavigationService.navigate('ProjectDetailedView', { projectIndex })
        dispatch(actions)
    }

    return (
        <SectionItemLayoutHeader
            icon={'settings'}
            text={translate('Project Settings')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
