import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import Header from '../../UIComponents/FloatModals/DueDateModal/Header'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'
import useEscapeKey from '../../../hooks/useEscapeKey'

// What "Copy link" offers for a note that a visitor could not open with the plain address: the note
// sits in a private project (or already has its public link on). The override is the note's public
// link (`publicLinkEnabled`, see hasPublicNoteLink in firestore.rules): read-only for anybody with
// the address, nothing else in the project opens.
export const NOTE_LINK_COPY_MEMBERS = 'members'
export const NOTE_LINK_ENABLE_AND_COPY = 'enable'
export const NOTE_LINK_COPY_PUBLIC = 'copyPublic'
export const NOTE_LINK_DISABLE = 'disable'

export const getNotePublicLinkOptions = publicLinkEnabled =>
    publicLinkEnabled
        ? [
              { action: NOTE_LINK_COPY_PUBLIC, icon: 'link', text: 'Copy public link' },
              { action: NOTE_LINK_DISABLE, icon: 'lock', text: 'Turn off public link' },
          ]
        : [
              { action: NOTE_LINK_COPY_MEMBERS, icon: 'users', text: 'Copy link for project members' },
              { action: NOTE_LINK_ENABLE_AND_COPY, icon: 'globe', text: 'Make public and copy' },
          ]

function Option({ icon, text, shortcut, onPress, disabled, testID }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const select = event => {
        event?.preventDefault?.()
        event?.stopPropagation?.()
        if (!disabled) onPress()
    }

    return (
        <Hotkeys keyName={shortcut} onKeyDown={(sht, event) => select(event)} filter={() => true}>
            <TouchableOpacity
                style={[localStyles.option, disabled && localStyles.disabled]}
                onPress={select}
                accessible={false}
                testID={testID}
            >
                <View style={localStyles.optionText}>
                    <Icon name={icon} size={24} color={'#ffffff'} style={localStyles.icon} />
                    <Text style={[styles.subtitle1, localStyles.label]} numberOfLines={1}>
                        {translate(text)}
                    </Text>
                </View>
                {!smallScreenNavigation && <Shortcut text={shortcut} theme={SHORTCUT_LIGHT} />}
            </TouchableOpacity>
        </Hotkeys>
    )
}

export default function NotePublicLinkModal({ publicLinkEnabled, onAction, closeModal }) {
    const [inProgress, setInProgress] = useState(false)
    const [failed, setFailed] = useState(false)

    useEscapeKey(() => closeModal())

    const run = async action => {
        setInProgress(true)
        setFailed(false)
        try {
            await onAction(action)
        } catch (error) {
            console.warn('[NotePublicLinkModal] action failed', action, error)
            setFailed(true)
            setInProgress(false)
        }
    }

    const title = translate(publicLinkEnabled ? 'Public link is on' : 'This project is private')
    const description = translate(
        publicLinkEnabled ? 'Note public link on description' : 'Note public link off description'
    )

    return (
        <View style={[localStyles.container, applyPopoverWidth()]} testID="note-public-link-modal">
            <Header delayClosePopover={closeModal} title={title} description={description} showTabs={false} />
            <View style={localStyles.options}>
                {getNotePublicLinkOptions(publicLinkEnabled).map((option, index) => (
                    <Option
                        key={option.action}
                        icon={option.icon}
                        text={option.text}
                        shortcut={String(index + 1)}
                        disabled={inProgress}
                        onPress={() => run(option.action)}
                        testID={`note-public-link-${option.action}`}
                    />
                ))}
                {failed && (
                    <Text style={[styles.body2, localStyles.error]} testID="note-public-link-error">
                        {translate('Note public link failed')}
                    </Text>
                )}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        paddingTop: 16,
        paddingBottom: 8,
        borderRadius: 4,
    },
    options: {
        paddingHorizontal: 16,
    },
    option: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    disabled: {
        opacity: 0.5,
    },
    optionText: {
        flexDirection: 'row',
        alignItems: 'center',
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    icon: {
        marginRight: 8,
    },
    label: {
        color: '#ffffff',
        flexShrink: 1,
    },
    error: {
        color: colors.UtilityRed200,
        paddingVertical: 8,
    },
})
