import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import global, { colors } from '../../styles/global'
import CloseButton from '../../FollowUp/CloseButton'
import Button from '../../UIControls/Button'
import { applyPopoverWidth } from '../../../utils/HelperFunctions'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import { translate } from '../../../i18n/TranslationService'

const NotAvailableScreenRecording = ({ onPress }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <Hotkeys
            keyName={'Esc'}
            onKeyDown={() => {
                onPress()
            }}
            filter={e => true}
        >
            <View style={[localStyles.container, applyPopoverWidth(), mobile && localStyles.mobile]}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Text style={[global.title7, localStyles.title]}>{translate('Ups, feature not available')}</Text>
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
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'fixed',
        zIndex: 1,
        left: '48.5%',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        height: 'auto',
        top: '50%',
        transform: [{ translateX: '-43%' }, { translateY: '-50%' }],
    },
    mobile: {
        transform: [{ translateX: '-48.5%' }, { translateY: '-50%' }],
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
