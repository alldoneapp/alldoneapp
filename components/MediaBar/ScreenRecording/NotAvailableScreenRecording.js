import React from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import global, { colors, hexColorToRGBa } from '../../styles/global'
import CloseButton from '../../FollowUp/CloseButton'
import Button from '../../UIControls/Button'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import Hotkeys from 'react-hot-keys'
import { translate } from '../../../i18n/TranslationService'
import { MODAL_Z_CONTENT } from '../../styles/modals'
import useSafeAreaOverlayPadding from '../../../hooks/useSafeAreaOverlayPadding'

const NotAvailableScreenRecording = ({ onPress }) => {
    const safeAreaOverlayPadding = useSafeAreaOverlayPadding()
    return (
        <Hotkeys
            keyName={'Esc'}
            onKeyDown={() => {
                onPress()
            }}
            filter={e => true}
        >
            <View style={[localStyles.parent, safeAreaOverlayPadding]}>
                <View style={[localStyles.container, applyPopoverWidth()]}>
                    <View style={{ paddingHorizontal: 16 }}>
                        <Text style={[global.title7, localStyles.title]}>
                            {translate('Ups, feature not available')}
                        </Text>
                        <Text style={[global.body1, localStyles.subTitle]}>
                            {translate('Ups, feature not available description')}
                        </Text>
                    </View>

                    <View style={localStyles.sectionSeparator} />

                    <View style={localStyles.button}>
                        <Button title={'Ok'} onPress={() => onPress()} />
                    </View>

                    <CloseButton
                        close={e => {
                            if (e) {
                                e.preventDefault()
                                e.stopPropagation()
                            }
                            onPress()
                        }}
                    />
                </View>
            </View>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    // Window-centered overlay with scrim (round-3 policy) — this is a pure
    // info dialog, so unlike the recorder cards a scrim is safe here.
    parent: {
        position: 'absolute',
        zIndex: MODAL_Z_CONTENT,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: hexColorToRGBa(colors.Text03, 0.24),
        ...Platform.select({ web: { position: 'fixed' } }),
    },
    container: {
        maxHeight: '90%',
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
    },
    sectionSeparator: {
        borderBottomWidth: 1,
        borderBottomColor: '#ffffff',
        marginVertical: 16,
        opacity: 0.2,
    },
    title: {
        marginBottom: 20,
        color: 'white',
    },
    subTitle: {
        color: colors.Gray400,
        textAlign: 'justify',
    },
    button: {
        alignSelf: 'center',
        paddingHorizontal: 16,
    },
})

export default NotAvailableScreenRecording
