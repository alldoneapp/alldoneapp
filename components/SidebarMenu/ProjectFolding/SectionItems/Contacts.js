import React from 'react'
import { useDispatch } from 'react-redux'

import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { hideFloatPopup, hideWebSideBar, setSelectedSidebarTab } from '../../../../redux/actions'
import { DV_TAB_ROOT_CONTACTS } from '../../../../utils/TabNavigationConstants'
import store from '../../../../redux/store'
import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'

export default function Contacts({ navigateToRoot, projectColor, selected }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        const { smallScreenNavigation } = store.getState()
        dismissAllPopups(true, true, true)
        const actionsToDispatch = [setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS), hideFloatPopup()]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        dispatch(actionsToDispatch)
        navigateToRoot()
    }

    return (
        <SectionItemLayoutHeader
            icon={'users'}
            text={translate('Contacts')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
