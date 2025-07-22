import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import { translate } from '../../../../i18n/TranslationService'

export default function DueDateCalendarModalFooter({ setVisibleCalendar }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const calendarShortcut = (event, value) => {
        event.preventDefault()
        event.stopPropagation()
        setVisibleCalendar(value)
    }

    return (
        <View style={[localStyles.estimationSection, localStyles.estimationLastSection]}>
            <TouchableOpacity
                style={localStyles.dateSectionItem}
                onPress={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    setVisibleCalendar(false)
                }}
                accessible={false}
            >
                <Hotkeys
                    key={10}
                    keyName={'B'}
                    onKeyDown={(sht, event) => calendarShortcut(event, false)}
                    filter={e => true}
                >
                    <View style={localStyles.dateSectionItem}>
                        <View style={[localStyles.navigateIndicator, localStyles.sectionItemReverse]}>
                            <Text style={[styles.body1, { color: colors.Text03 }]}>
                                <Icon name={'chevron-left'} size={24} color={colors.Text03} />
                            </Text>
                        </View>
                        <View style={localStyles.sectionItemText}>
                            <Text style={[styles.subtitle1, { color: '#ffffff' }]}>{translate('Select reminder')}</Text>
                        </View>
                        {!smallScreenNavigation && (
                            <View style={localStyles.shortcut}>
                                <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                            </View>
                        )}
                    </View>
                </Hotkeys>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    estimationSection: {
        flex: 1,
        justifyContent: 'space-around',
        overflow: 'visible',
        paddingLeft: 16,
        paddingRight: 16,
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
    navigateIndicator: {
        marginTop: 4,
    },
    sectionItemReverse: {
        justifyContent: 'flex-start',
        marginRight: 12,
    },
    estimationLastSection: {
        paddingBottom: 8,
    },
    shortcut: {
        position: 'absolute',
        right: 0,
    },
})
