import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'
import {
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
} from '../../../utils/TabNavigationConstants'
import ChangeObjectListModalItem from './ChangeObjectListModalItem'

export default function ChangeObjectListModal({ closePopover }) {
    const [width, height] = useWindowSize()

    const section = [
        { text: 'Tasks', icon: 'check-square', value: DV_TAB_ROOT_TASKS, shortcut: '1' },
        { text: 'Goals', icon: 'target', value: DV_TAB_ROOT_GOALS, shortcut: '2' },
        { text: 'Notes', icon: 'file-text', value: DV_TAB_ROOT_NOTES, shortcut: '3' },
        { text: 'Contacts', icon: 'users', value: DV_TAB_ROOT_CONTACTS, shortcut: '4' },
        { text: 'Chats', icon: 'comments-thread', value: DV_TAB_ROOT_CHATS, shortcut: '5' },
        { text: 'Updates', icon: 'bell', value: DV_TAB_ROOT_UPDATES, shortcut: '6' },
    ]

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <Hotkeys keyName={'esc'} onKeyDown={closePopover} filter={e => true}>
                    <View style={{ marginBottom: 20 }}>
                        <Text style={[styles.title7, { color: '#ffffff' }]}>{translate('Switch section')}</Text>
                        <Text style={[styles.body2, { color: colors.Text03 }]}>
                            {translate('Select the section you want to switch to')}
                        </Text>
                    </View>
                </Hotkeys>

                {section.map(item => (
                    <ChangeObjectListModalItem key={item.text} sectionItem={item} closePopover={closePopover} />
                ))}

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
