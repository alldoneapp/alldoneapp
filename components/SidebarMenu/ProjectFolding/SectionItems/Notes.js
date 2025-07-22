import React from 'react'
import { useDispatch } from 'react-redux'

import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { hideFloatPopup, hideWebSideBar, setSelectedSidebarTab } from '../../../../redux/actions'
import { DV_TAB_ROOT_NOTES } from '../../../../utils/TabNavigationConstants'
import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import store from '../../../../redux/store'

export default function Notes({ navigateToRoot, projectColor, selected }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        const { smallScreenNavigation } = store.getState()
        dismissAllPopups(true, true, true)
        const actionsToDispatch = [setSelectedSidebarTab(DV_TAB_ROOT_NOTES), hideFloatPopup()]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        dispatch(actionsToDispatch)
        navigateToRoot()
    }

    return (
        <SectionItemLayoutHeader
            icon={'file-text'}
            text={translate('Notes')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
