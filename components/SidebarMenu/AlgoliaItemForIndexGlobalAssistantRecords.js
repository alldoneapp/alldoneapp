import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles from '../styles/global'
import Icon from '../Icon'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../hooks/UseOnHover'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { startGlobalAssistantsIndexationInAlgolia } from '../GlobalSearchAlgolia/searchHelper'

export default function AlgoliaItemForIndexGlobalAssistantRecords() {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const [indexing, setIndexing] = useState(false)
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.Marketplace')

    const onPress = async () => {
        setIndexing(true)
        await startGlobalAssistantsIndexationInAlgolia()
    }

    return (
        <TouchableOpacity
            style={[
                localStyles.container,
                !expanded && localStyles.containerCollapsed,
                theme.container,
                hover && theme.containerActive,
            ]}
            accessible={false}
            onPress={onPress}
            onMouseEnter={onHover}
            onMouseLeave={offHover}
            disabled={indexing}
        >
            <View style={localStyles.headerContainer}>
                <Icon size={22} name={'refresh-ccw'} color={theme.text.color} style={{ marginRight: 10 }} />
                {expanded && <Text style={[localStyles.text, theme.text]}>Reload Algolia</Text>}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingLeft: 24,
        alignItems: 'center',
        flexDirection: 'row',
        height: 56,
        justifyContent: 'space-between',
        marginTop: 32,
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    headerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.body1,
    },
})
