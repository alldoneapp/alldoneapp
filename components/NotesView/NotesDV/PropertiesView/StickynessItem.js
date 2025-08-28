import React, { useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import styles, { colors } from '../../../styles/global'
import Backend from '../../../../utils/BackendBridge'
import Shortcut, { SHORTCUT_LIGHT } from '../../../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import moment from 'moment'
import { translate } from '../../../../i18n/TranslationService'
import { updateNoteStickyData } from '../../../../utils/backends/Notes/notesFirestore'
import { updateStickyChatData } from '../../../../utils/backends/Chats/chatsFirestore'

const StickynessItem = ({ days, number, note, projectId, hidePopover, saveStickyBeforeSaveNote, isChat }) => {
    const showShortcuts = useSelector(state => state.showShortcuts)
    const btnRef = useRef()

    const onPress = () => {
        const stickyEndDate = moment().add(days, 'days').valueOf()
        const stickyData = days === 0 ? { days: 0, stickyEndDate: 0 } : { days, stickyEndDate }

        if (saveStickyBeforeSaveNote !== undefined) {
            hidePopover()
            saveStickyBeforeSaveNote(stickyData)
        } else {
            if (!isChat) {
                updateNoteStickyData(projectId, note.id, stickyData)
            } else {
                updateStickyChatData(projectId, note.id, stickyData)
            }
            hidePopover()
        }
    }

    return (
        <Hotkeys
            keyName={number.toString()}
            onKeyDown={(sht, event) => execShortcutFn(btnRef.current, onPress, event)}
            filter={e => true}
        >
            <TouchableOpacity ref={btnRef} style={localStyles.container} onPress={onPress}>
                <View>
                    <Text style={[styles.subtitle1, { color: 'white' }]}>{parseDays(days)}</Text>
                </View>
                <View style={localStyles.itemContainer}>
                    <Text style={{ color: colors.Gray400 }}>{number}</Text>

                    {showShortcuts && (
                        <View style={localStyles.shortcut}>
                            <Shortcut text={number.toString()} theme={SHORTCUT_LIGHT} />
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        </Hotkeys>
    )
}

const parseDays = days => {
    if (days >= 365) {
        return translate('Forever')
    } else if (days === 0) {
        return translate('Unstick')
    } else if (days > 1) {
        return translate('Sticky for x days', { days })
    } else {
        return translate('Sticky for 1 day')
    }
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingRight: 8,
        height: 40,
    },
    itemContainer: {
        borderWidth: 1,
        borderRadius: 4,
        width: 15,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderColor: colors.Gray400,
    },
    shortcut: {
        position: 'absolute',
        right: 16,
    },
})

export default StickynessItem
