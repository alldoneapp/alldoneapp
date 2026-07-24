import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { useSelector } from 'react-redux'

const Indicator = ({}) => {
    const mobile = useSelector(state => state.smallScreenNavigation)
    return (
        <View style={localStyles.container}>
            {!mobile && <Text style={[styles.subtitle1, { color: colors.Text03 }]}>{translate('PROJECT')}</Text>}
            <View style={{ marginLeft: 12 }}>
                <Icon name="circle" size={24} color={colors.Text03} />
            </View>
        </View>
    )
}

export default Indicator

const localStyles = StyleSheet.create({
    container: {
        marginTop: 36,
        backgroundColor: 'white',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
