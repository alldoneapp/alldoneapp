import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import global, { colors } from '../../styles/global'
import CustomScrollView from '../../UIControls/CustomScrollView'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'

const CancelRecord = ({ setShowClose, closeModal }) => {
    return (
        <View style={localStyles.center}>
            <CustomScrollView contentContainerStyle={localStyles.container}>
                <Text style={[global.title7, { color: 'white' }]}>
                    {translate('Be careful, this action is permanent')}
                </Text>
                <Text style={[global.body2, { color: colors.Text03 }]}>
                    {translate('Do you really want to cancel the screen recording and lose the video?')}
                </Text>
                <View style={localStyles.footer}>
                    <Button
                        title={translate('Cancel')}
                        type={'secondary'}
                        buttonStyle={{ marginRight: 8 }}
                        onPress={() => setShowClose(false)}
                    />
                    <Button
                        title={translate('Proceed')}
                        type={'danger'}
                        onPress={() => {
                            window.stopCallback && window.stopCallback()
                            closeModal()
                        }}
                    />
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    center: {
        position: 'fixed',
        left: '48.5%',
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        paddingVertical: 16,
        paddingHorizontal: 16,
        height: 'auto',
        top: '50%',
        transform: [{ translateX: '-43%' }, { translateY: '-50%' }],
    },
    container: {
        width: 317,
    },
    footer: {
        flex: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 20,
    },
})

export default CancelRecord
