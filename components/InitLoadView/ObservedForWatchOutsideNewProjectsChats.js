import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import { difference } from 'lodash'

import { watchProjectChatNotifications } from '../../utils/InitialLoad/initialLoadHelper'

export default function ObservedForWatchOutsideNewProjectsChats() {
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds)
    const [watchedTemplateProjectIds, setWatchedTemplateProjectIds] = useState(templateProjectIds)
    const [watchedGuideProjectIds, setWatchedGuideProjectIds] = useState(guideProjectIds)

    useEffect(() => {
        const newTemplateIds = difference(templateProjectIds, watchedTemplateProjectIds)
        if (newTemplateIds.length > 0) {
            setWatchedTemplateProjectIds(templateProjectIds)
            newTemplateIds.forEach(projectId => {
                watchProjectChatNotifications(projectId)
            })
        }
    }, [templateProjectIds])

    useEffect(() => {
        const newGuideIds = difference(guideProjectIds, watchedGuideProjectIds)
        if (newGuideIds.length > 0) {
            setWatchedGuideProjectIds(guideProjectIds)
            newGuideIds.forEach(projectId => {
                watchProjectChatNotifications(projectId)
            })
        }
    }, [guideProjectIds])

    return <View />
}
