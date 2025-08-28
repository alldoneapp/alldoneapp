import React from 'react'
import { View } from 'react-native'

import ContactObjectHeader from './ContactObjectHeader'
import ContactObjectBody from './ContactObjectBody'

export default function ContactObject({ feedObjectData, projectId, feedViewData, feedActiveTab, style }) {
    const { object, feeds } = feedObjectData
    const { contactId, lastChangeDate } = object
    const { type: viewType } = feedViewData
    return (
        <View style={style}>
            {viewType !== 'contact' && <ContactObjectHeader feed={object} projectId={projectId} />}
            <ContactObjectBody
                feeds={feeds}
                contactId={contactId}
                projectId={projectId}
                lastChangeDate={lastChangeDate}
                feedActiveTab={feedActiveTab}
            />
        </View>
    )
}
