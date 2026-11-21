import React from 'react'
import { useDispatch } from 'react-redux'

import { translate } from '../../../../i18n/TranslationService'
import { DV_TAB_ROOT_WIKI } from '../../../../utils/TabNavigationConstants'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import { openProjectWiki } from '../../../WikiView/wikiLinks'
import { openAllProjectsSection } from './allProjectsSection'

// Without a project (All projects, AT-3121) it switches the section there.
export default function Wiki({ projectId, projectColor, selected, navigateToRoot }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        if (projectId) openProjectWiki(projectId)
        else openAllProjectsSection(dispatch, DV_TAB_ROOT_WIKI, navigateToRoot)
    }

    return (
        <SectionItemLayoutHeader
            icon={'book-open'}
            text={translate('Wiki')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
