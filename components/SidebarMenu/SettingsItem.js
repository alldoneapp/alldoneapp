import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import styles from '../styles/global'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import useOnHover from '../../hooks/UseOnHover'
import { navigateToSettings } from '../../redux/actions'
import { DV_TAB_SETTINGS_CUSTOMIZATIONS } from '../../utils/TabNavigationConstants'
import NavigationService from '../../utils/NavigationService'

export default function SettingsItem() {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()
    const { hover, onHover, offHover } = useOnHover()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.HelpItem')

    const onPress = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_CUSTOMIZATIONS }))
        NavigationService.navigate('SettingsView')
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
                <Icon
                    size={22}
                    name={'settings'}
                    color={theme.text.color}
                    style={{ marginRight: 10, opacity: theme.text.opacity }}
                />
                {expanded && <Text style={[localStyles.text, theme.text]}>{translate('Settings')}</Text>}
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
