import React from 'react'
import { useDispatch } from 'react-redux'

import { translate } from '../../../../i18n/TranslationService'
import { DV_TAB_ROOT_ARTIFACTS } from '../../../../utils/TabNavigationConstants'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import { openProjectArtifacts } from '../../../ArtifactsView/artifactLinks'
import { openAllProjectsSection } from './allProjectsSection'

// Without a project (All projects, AT-3121) it switches the section there.
export default function Artifacts({ projectId, projectColor, selected, navigateToRoot }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        if (projectId) openProjectArtifacts(projectId)
        else openAllProjectsSection(dispatch, DV_TAB_ROOT_ARTIFACTS, navigateToRoot)
    }

    return (
        <SectionItemLayoutHeader
            icon={'package'}
            text={translate('Artifacts')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
