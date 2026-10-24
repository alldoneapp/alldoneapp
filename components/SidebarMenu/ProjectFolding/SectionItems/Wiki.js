import React from 'react'

import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import { openProjectWiki } from '../../../WikiView/wikiLinks'

export default function Wiki({ projectId, projectColor, selected }) {
    const onPress = e => {
        e?.preventDefault()
        openProjectWiki(projectId)
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
