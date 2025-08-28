import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

const AddMember = ({ onPress }) => {
    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Icon name="plus-square" size={24} color={colors.Primary100} />
            <View style={{ marginLeft: 20 }}>
                <Text style={[styles.body1, { color: colors.Text03 }]}>
                    {translate('Type an email to send invitation')}
                </Text>
            </View>
        </TouchableOpacity>
    )
}

export default AddMember

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        paddingLeft: 8,
    },
})
