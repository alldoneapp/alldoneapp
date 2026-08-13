import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { translate } from '../../../i18n/TranslationService'
import { setUserAutoArchiveProjectsAfterDays } from '../../../utils/backends/Users/usersFirestore'
import {
    autoArchiveProjectsAfterDaysOptions,
    formatAutoArchiveProjectsAfterDays,
    normalizeAutoArchiveProjectsAfterDays,
} from '../../SettingsView/Customizations/Properties/autoArchiveProjectsAfterDaysHelper'

export default function AutoArchiveProjectsAfterDaysModal({ userId, autoArchiveProjectsAfterDays, closePopover }) {
    const [, height] = useWindowSize()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const currentValue = normalizeAutoArchiveProjectsAfterDays(autoArchiveProjectsAfterDays)

    const onSelectValue = (value, event) => {
        if (event != null) {
            event.preventDefault()
            event.stopPropagation()
        }

        setUserAutoArchiveProjectsAfterDays(userId, value)
        closePopover()
    }

    const renderItem = option => {
        const isSelected = option.value === currentValue
        const { textKey, interpolations } = formatAutoArchiveProjectsAfterDays(option.value)
        const label = translate(textKey, interpolations)

        return (
            <View key={option.shortcut}>
                <Hotkeys
                    key={option.shortcut}
                    keyName={option.shortcut}
                    onKeyDown={(shortcut, event) => onSelectValue(option.value, event)}
                    filter={e => true}
                >
                    <TouchableOpacity style={localStyles.item} onPress={event => onSelectValue(option.value, event)}>
                        <View style={localStyles.item}>
                            <View style={localStyles.itemText}>
                                <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{label}</Text>
                            </View>
                            <View style={localStyles.itemCheck}>
                                {isSelected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                                {!mobile && (
                                    <Shortcut
                                        text={option.shortcut}
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
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Auto-Archive projects')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Projects with no activity for this long are archived automatically')}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03, marginTop: 8 }]}>
                            {translate('Your default project is never archived automatically')}
                        </Text>
                    </View>
                </Hotkeys>

                {autoArchiveProjectsAfterDaysOptions.map(renderItem)}

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
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
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
    item: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    itemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    itemCheck: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
