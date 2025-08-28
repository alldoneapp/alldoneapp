import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

const Indicator = () => {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <View>
            <View style={localStyles.container}>
                {!mobile && <Text style={[styles.subtitle1, { color: colors.Text03 }]}>{translate('NOTE')}</Text>}
                <View style={{ marginLeft: 14 }}>
                    <Icon name="file-text" size={20} color={colors.Text03} />
                </View>
            </View>
        </View>
    )
}

export default Indicator

const localStyles = StyleSheet.create({
    container: {
        marginTop: 4,
        backgroundColor: 'white',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
