import React from 'react'

import Button from '../../../UIControls/Button'
import { translate } from '../../../../i18n/TranslationService'
import {
    PROJECT_TYPE_ARCHIVED,
    PROJECT_TYPE_GUIDE,
    PROJECT_TYPE_TEMPLATE,
} from '../../../SettingsView/ProjectsSettings/ProjectsSettings'
import { useSelector } from 'react-redux'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ProjectStatusButton({ projectId, disabled, openModal }) {
    const loggedUser = useSelector(state => state.loggedUser)

    const projectStatus = ProjectHelper.getTypeOfProject(loggedUser, projectId)

    const icon =
        projectStatus === PROJECT_TYPE_ARCHIVED
            ? 'archive'
            : projectStatus === PROJECT_TYPE_TEMPLATE || projectStatus === PROJECT_TYPE_GUIDE
            ? 'map'
            : 'circle'

    const text =
        projectStatus === PROJECT_TYPE_ARCHIVED
            ? 'Archive'
            : projectStatus === PROJECT_TYPE_TEMPLATE
            ? 'Template'
            : projectStatus === PROJECT_TYPE_GUIDE
            ? 'Community'
            : 'Normal'

    return <Button icon={icon} title={translate(text)} type={'ghost'} onPress={openModal} disabled={disabled} />
}
