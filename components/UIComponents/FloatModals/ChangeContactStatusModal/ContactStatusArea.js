import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import ContactStatusItem from './ContactStatusItem'
import { translate } from '../../../../i18n/TranslationService'

export default function ContactStatusArea({ closeModal, projectId, updateStatus, currentStatusId }) {
    const projectsMap = useSelector(state => state.loggedUserProjectsMap)
    const project = projectsMap[projectId]

    const statuses = project?.contactStatuses ? Object.values(project.contactStatuses) : []
    const sortedStatuses = [...statuses].sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0))

    return (
        <View style={{ marginHorizontal: -8 }}>
            <ContactStatusItem
                key={'no-status'}
                status={{
                    id: null,
                    name: translate('No status'),
                    color: null,
                }}
                updateStatus={updateStatus}
                closeModal={closeModal}
                currentStatusId={currentStatusId}
            />
            {sortedStatuses.map(status => (
                <ContactStatusItem
                    key={status.id}
                    status={status}
                    updateStatus={updateStatus}
                    closeModal={closeModal}
                    currentStatusId={currentStatusId}
                />
            ))}
        </View>
    )
}
