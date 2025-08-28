import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../styles/global'
import Icon from '../Icon'
import { deleteCacheAndRefresh } from '../../utils/Observers'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'

export default function Version() {
    const showSideBarVersionRefresher = useSelector(state => state.showSideBarVersionRefresher)
    const alldoneVersion = useSelector(state => state.alldoneVersion)
    const alldoneNewVersion = useSelector(state => state.alldoneNewVersion)
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.Version')

    return (
        <View style={localstyle.container}>
            <Text style={[localstyle.text, theme.text]} numberOfLines={1}>
                Alldone.app v{alldoneVersion.major}.{alldoneVersion.minor}
            </Text>
            {showSideBarVersionRefresher & !alldoneNewVersion.isMandatory ? (
                <View style={{ flex: 1 }}>
                    <TouchableOpacity
                        testID="refreshButton"
                        style={[localstyle.refresh, theme.refresh]}
                        onPress={deleteCacheAndRefresh}
                    >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name="refresh-cw" color="#FFFFFF" size={16} />
                            <Text style={[localstyle.refreshText, theme.refreshText]} numberOfLines={1}>
                                v{alldoneNewVersion.major}.{alldoneNewVersion.minor}
                            </Text>
                        </View>
                    </TouchableOpacity>
                </View>
            ) : null}
        </View>
    )
}

const localstyle = StyleSheet.create({
    container: {
        width: '100%',
        paddingHorizontal: 24,
        height: 48,
        alignItems: 'center',
        flexDirection: 'row',
    },
    text: {
        ...styles.body2,
        opacity: 0.4,
        flex: 1,
        flexWrap: 'nowrap',
    },
    refresh: {
        minWidth: 64,
        height: 24,
        borderRadius: 12,
        justifyContent: 'center',
        paddingLeft: 4,
        paddingRight: 10,
        alignSelf: 'flex-end',
    },
    refreshText: {
        ...styles.subtitle2,
        fontFamily: 'Roboto-regular',
        fontWeight: '500',
        marginLeft: 6,
        flexWrap: 'nowrap',
    },
})
