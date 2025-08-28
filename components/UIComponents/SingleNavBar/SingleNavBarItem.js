import React from 'react'
import { SINGLE_NAV_BAR_DARK, SINGLE_NAV_BAR_LIGHT } from './SingleNavBar'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

export default function SingleNavBarItem({
    text,
    selected,
    onSelect,
    theme = SINGLE_NAV_BAR_DARK,
    style,
    isNextShortcutTab,
}) {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const PART_UNDERLINE = 'PART_UNDERLINE'
    const PART_TEXT_SELECTED = 'PART_TEXT_SELECTED'
    const PART_TEXT = 'PART_TEXT'

    const themeStyle = part => {
        switch (part) {
            case PART_UNDERLINE:
                if (theme === SINGLE_NAV_BAR_LIGHT) {
                    return localStyles.underlineActiveLight
                } else {
                    return localStyles.underlineActiveDark
                }
            case PART_TEXT:
                if (theme === SINGLE_NAV_BAR_LIGHT) {
                    return localStyles.lightText
                } else {
                    return localStyles.darkText
                }
            case PART_TEXT_SELECTED:
                if (theme === SINGLE_NAV_BAR_LIGHT) {
                    return localStyles.selectLightText
                } else {
                    return localStyles.selectDarkText
                }
        }
    }

    return (
        <TouchableOpacity style={[localStyles.parent, style]} onPress={onSelect}>
            <View style={localStyles.container}>
                <Text
                    style={
                        selected
                            ? [styles.subtitle2, themeStyle(PART_TEXT_SELECTED)]
                            : [styles.body2, themeStyle(PART_TEXT)]
                    }
                >
                    {translate(text)}
                </Text>
            </View>

            <View style={[localStyles.underline, selected && themeStyle(PART_UNDERLINE)]} />

            {showShortcuts && isNextShortcutTab && (
                <View style={{ position: 'absolute', top: 0, right: -2 }}>
                    <Shortcut text={'Just_Tab'} theme={SHORTCUT_LIGHT} />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 44,
        marginLeft: 32,
        marginRight: 32,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
    },
    parent: {
        flex: 1,
        flexDirection: 'column',
        marginRight: 12,
    },
    underline: {
        width: '100%',
        height: 4,
        backgroundColor: 'transparent',
    },
    underlineActiveLight: {
        backgroundColor: colors.Grey400,
    },
    underlineActiveDark: {
        backgroundColor: colors.Primary400,
    },
    lightText: {
        color: colors.Text03,
    },
    darkText: {
        color: colors.Text03,
    },
    selectLightText: {
        color: '#ffffff',
    },
    selectDarkText: {
        color: colors.Primary400,
    },
})
