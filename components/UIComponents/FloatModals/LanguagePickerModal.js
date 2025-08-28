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
import { useTranslator, translate } from '../../../i18n/TranslationService'
import { setUserLanguage } from '../../../utils/backends/Users/usersFirestore'

export default function LanguagePickerModal({ userId, language, closePopover }) {
    useTranslator()
    const langOptions = [
        { symbol: translate('English'), language: 'en', shortcut: '1', icon: require('../../../i18n/icons/UK.svg') },
        { symbol: translate('Spanish'), language: 'es', shortcut: '2', icon: require('../../../i18n/icons/Spain.svg') },
        {
            symbol: translate('German'),
            language: 'de',
            shortcut: '3',
            icon: require('../../../i18n/icons/Germany.svg'),
        },
    ]
    const [width, height] = useWindowSize()
    const mobile = useSelector(state => state.smallScreenNavigation)

    const renderItem = (lang, i) => {
        const isSelected =
            (language != null && language === lang.language) || (language == null && 'en' === lang.language)

        const onPress = e => {
            if (e != null) {
                e.preventDefault()
                e.stopPropagation()
            }

            setUserLanguage(userId, lang.language)
            closePopover()
        }

        return (
            <View key={i}>
                <Hotkeys key={i} keyName={lang.shortcut} onKeyDown={(sht, event) => onPress(event)} filter={e => true}>
                    <TouchableOpacity style={localStyles.dateSectionItem} onPress={onPress}>
                        <View style={localStyles.dateSectionItem}>
                            <View style={localStyles.sectionItemText}>
                                <View style={localStyles.icon}>
                                    <img src={lang.icon} alt={lang.language} />
                                </View>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{lang.symbol}</Text>
                            </View>
                            <View style={localStyles.sectionItemCheck}>
                                {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                                {!mobile && (
                                    <Shortcut
                                        text={lang.shortcut}
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
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Select language')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Language will be applied to across the app')}
                        </Text>
                    </View>
                </Hotkeys>

                {langOptions.map((item, i) => renderItem(item, i))}

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
    dateSectionItem: {
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
    icon: {
        width: 24,
        height: 24,
        marginRight: 8,
        borderRadius: 4,
        overflow: 'hidden',
    },
})
