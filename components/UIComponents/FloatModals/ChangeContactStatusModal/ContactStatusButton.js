import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import { translate } from '../../../../i18n/TranslationService'

export default function ContactStatusButton({ projectId, disabled, statusId, onPress }) {
    const projectsMap = useSelector(state => state.loggedUserProjectsMap)
    const project = projectsMap[projectId]

    const status = statusId && project?.contactStatuses ? project.contactStatuses[statusId] : null

    return (
        <Button
            type={'ghost'}
            icon={status ? <View style={[localStyles.colorDot, { backgroundColor: status.color }]} /> : 'tag'}
            title={shrinkTagText(status ? status.name : translate('No status'), 30)}
            onPress={onPress}
            disabled={disabled}
        />
    )
}

const localStyles = StyleSheet.create({
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
    },
})
