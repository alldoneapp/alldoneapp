import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../../Icon'
import { getUserItemTheme } from '../../Themes'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import WorkstreamName from './WorkstreamName'

export default function WorkstreamData({ workstreamId, workstreamName }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)
    const highlight = currentUserId === workstreamId

    return (
        <View style={localStyles.container}>
            <Icon
                size={20}
                name={'workstream'}
                color={highlight ? theme.nameActive.color : theme.name.color}
                style={localStyles.icon}
            />
            {expanded && <WorkstreamName workstreamId={workstreamId} workstreamName={workstreamName} />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        height: 20,
        width: 20,
        marginRight: 10,
    },
})
