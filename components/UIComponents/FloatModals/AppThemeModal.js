import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import Backend from '../../../utils/BackendBridge'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { COLORS_THEME_DEFAULT, COLORS_THEME_MODERN } from '../../../Themes/Themes'
import { translate } from '../../../i18n/TranslationService'
import { setUserThemeName } from '../../../utils/backends/Users/usersFirestore'

const themeOptions = [
    { symbol: 'Default', value: COLORS_THEME_DEFAULT, shortcut: '1', name: 'Blue' },
    { symbol: 'Modern', value: COLORS_THEME_MODERN, shortcut: '2', name: 'Light' },
    // { symbol: 'Dark (coming soon)', value: COLORS_THEME_DARK, shortcut: '3', name:'Dark' },
]

export const themeOptionsMap = {
    [COLORS_THEME_DEFAULT]: themeOptions[0],
    [COLORS_THEME_MODERN]: themeOptions[1],
}

export default function AppThemeModal({ userId, themeName, closePopover }) {
    const [width, height] = useWindowSize()
    const mobile = useSelector(state => state.smallScreenNavigation)

    const renderItem = (themeItem, i) => {
        const selected = themeItem.value === themeName

        const onPress = e => {
            if (e != null) {
                e.preventDefault()
                e.stopPropagation()
            }

            setUserThemeName(userId, themeItem.value)
            closePopover()
        }

        return (
            <View key={i}>
                <Hotkeys
                    key={i}
                    keyName={themeItem.shortcut}
                    onKeyDown={(sht, event) => onPress(event)}
                    filter={e => true}
                >
                    <TouchableOpacity style={localStyles.themeSectionItem} onPress={onPress}>
                        <View style={localStyles.themeSectionItem}>
                            <View style={localStyles.sectionItemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>
                                    {translate(themeItem.name)}
                                </Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {selected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                                {!mobile && (
                                    <Shortcut
                                        text={themeItem.shortcut}
                                        theme={SHORTCUT_LIGHT}
                                        containerStyle={{ marginLeft: 4 }}
                                    />
                                )}
                            </View>
                        </View>
                    </TouchableOpacity>
                </Hotkeys>
            </View>
        )
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Hotkeys keyName={'esc'} onKeyDown={closePopover} filter={e => true}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Select app theme')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Theme that will be applied to across the app')}
                        </Text>
                    </View>
                </Hotkeys>

                {themeOptions.map((item, i) => renderItem(item, i))}

                <View style={localStyles.closeContainer}>
                    <TouchableOpacity style={localStyles.closeButton} onPress={closePopover}>
                        <Icon name="x" size={24} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        paddingBottom: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: -4,
        right: -4,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    themeSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
