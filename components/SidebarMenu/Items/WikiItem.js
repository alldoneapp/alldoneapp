import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import { hideWebSideBar } from '../../../redux/actions'
import { DV_TAB_ROOT_WIKI } from '../../../utils/TabNavigationConstants'
import { translate } from '../../../i18n/TranslationService'
import { openProjectWiki } from '../../WikiView/wikiLinks'
import SidebarLinkItem from './SidebarLinkItem'

// The project wiki in the simple sidebar, under the project's people.
export default function WikiItem({ projectId, projectColor }) {
    const dispatch = useDispatch()
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const route = useSelector(state => state.route)

    const highlight = selectedSidebarTab === DV_TAB_ROOT_WIKI && route !== 'ProjectDetailedView'

    const onPress = e => {
        e?.preventDefault()
        openProjectWiki(projectId)
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
    }

    return (
        <SidebarLinkItem
            icon={'book-open'}
            text={translate('Wiki')}
            highlight={highlight}
            onPress={onPress}
            projectColor={projectColor}
            accessibilityLabel={'sidebar-wiki-item'}
            nativeID={`sidebar-wiki@${projectId}`}
        />
    )
}
