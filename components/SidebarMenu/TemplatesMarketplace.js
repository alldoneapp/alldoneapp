import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../hooks/UseOnHover'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'

export default function TemplatesMarketplace() {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.Marketplace')

    const onPress = () => {
        window.open(`https://www.alldone.app/goals`, '_blank')
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
        >
            <View style={localStyles.headerContainer}>
                <Icon size={22} name={'map-pin'} color={theme.text.color} style={{ marginRight: 10 }} />
                {expanded && <Text style={[localStyles.text, theme.text]}>{translate('All Goals')}</Text>}
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
