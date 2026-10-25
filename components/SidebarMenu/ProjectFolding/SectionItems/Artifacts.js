import React from 'react'

import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import { openProjectArtifacts } from '../../../ArtifactsView/artifactLinks'

export default function Artifacts({ projectId, projectColor, selected }) {
    const onPress = e => {
        e?.preventDefault()
        openProjectArtifacts(projectId)
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
