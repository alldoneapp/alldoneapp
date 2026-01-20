import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

const AddNewContactStatus = ({ onPress }) => (
    <TouchableOpacity style={localStyles.container} onPress={onPress}>
        <Icon name="plus-square" size={24} color={colors.Primary100} />
        <View style={{ marginLeft: 12 }}>
            <Text style={[styles.body1, { color: colors.Text03 }]}>{translate('Add new status')}</Text>
        </View>
    </TouchableOpacity>
)
export default AddNewContactStatus

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        borderColor: colors.Grey300,
        borderWidth: 1,
        borderRadius: 4,
        paddingLeft: 8,
    },
})
