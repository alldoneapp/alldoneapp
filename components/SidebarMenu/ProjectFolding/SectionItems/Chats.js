import React from 'react'
import { useDispatch } from 'react-redux'

import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import store from '../../../../redux/store'
import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import { getSidebarChatsActions } from '../../openSidebarChats'

export default function Chats({ navigateToRoot, projectColor, selected, projectId, inAllProjects }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        dismissAllPopups(true, true, true)

        const actionsToDispatch = getSidebarChatsActions(store.getState(), projectId, inAllProjects)

        navigateToRoot()
        dispatch(actionsToDispatch)
    }

    return (
        <SectionItemLayoutHeader
            icon={'comments-thread'}
            text={translate('Chats')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
        />
    )
}
