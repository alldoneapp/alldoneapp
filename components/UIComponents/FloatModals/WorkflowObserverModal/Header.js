import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../../styles/global'
import CloseButton from '../../../FollowUp/CloseButton'
import { useSelector } from 'react-redux'
import { translate } from '../../../../i18n/TranslationService'

export default function Header({ onPressClose }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    return (
        <View style={localStyles.container}>
            <View style={{ marginTop: 8 }}>
                <Text style={localStyles.title}>{translate('Select what to do')}</Text>
                <Text
                    style={[
                        localStyles.description,
                        { width: smallScreenNavigation ? 273 : isMiddleScreen ? 336 : 400 },
                    ]}
                >
                    {translate('Select what to do description')}
                </Text>
            </View>
            <CloseButton close={onPressClose} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        ...styles.title7,
        color: 'white',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
})
