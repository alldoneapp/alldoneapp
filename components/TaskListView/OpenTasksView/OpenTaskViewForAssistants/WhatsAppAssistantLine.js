import React, { useState, useCallback } from 'react'
import { Image, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import ChangePhoneModal from '../../../UIComponents/FloatModals/ChangePhoneModal'
import { setUserPhone } from '../../../../utils/backends/Users/usersFirestore'

const WHATSAPP_LINK = 'https://wa.me/4915128061330'
const WHATSAPP_NUMBER_DISPLAY = '+49 1512 8061330'

function openWhatsAppLink() {
    if (Platform.OS === 'web') {
        window.open(WHATSAPP_LINK, '_blank')
    } else {
        Linking.openURL(WHATSAPP_LINK)
    }
}

export default function WhatsAppAssistantLine() {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const phone = useSelector(state => state.loggedUser.phone)
    const smallScreen = useSelector(state => state.smallScreen)
    const [open, setOpen] = useState(false)

    const handlePress = useCallback(() => {
        if (phone) {
            openWhatsAppLink()
        } else {
            setOpen(true)
        }
    }, [phone])

    const handleSavePhone = useCallback(
        async newPhone => {
            await setUserPhone(loggedUserId, newPhone)
            openWhatsAppLink()
        },
        [loggedUserId]
    )

    return (
        <View style={localStyles.container}>
            <Popover
                content={
                    <ChangePhoneModal
                        closePopover={() => setOpen(false)}
                        onSaveData={handleSavePhone}
                        currentPhone={phone}
                    />
                }
                onClickOutside={() => setOpen(false)}
                isOpen={open}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <TouchableOpacity
                    style={localStyles.row}
                    onPress={handlePress}
                    accessible
                    accessibilityLabel="Chat with Anna on WhatsApp"
                >
                    <Image source={require('../../../../assets/whatsapp.png')} style={localStyles.icon} />
                    <Text style={localStyles.text}>
                        {translate('Chat with Anna on WhatsApp')}: {WHATSAPP_NUMBER_DISPLAY}
                    </Text>
                </TouchableOpacity>
            </Popover>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: colors.Grey200,
        borderRadius: 4,
        marginBottom: 24,
        paddingLeft: 10,
        paddingRight: 16,
        paddingVertical: 10,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        width: 24,
        height: 24,
        marginRight: 12,
    },
    text: {
        ...styles.body2,
        color: colors.Text03,
    },
})
