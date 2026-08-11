import React, { Component } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import store from '../../../redux/store'
import { translate } from '../../../i18n/TranslationService'

export default class Indicator extends Component {
    constructor(props) {
        super(props)
    }

    render() {
        const mobile = store.getState().smallScreenNavigation
        const { isSubtask } = this.props
        return (
            <View>
                <View style={localStyles.container}>
                    {!mobile && <Text style={localStyles.text}>{translate(isSubtask ? 'SUBTASK' : 'TASK')}</Text>}
                    <View style={{ marginLeft: 14 }}>
                        <Icon name={isSubtask ? 'check-square-Sub' : 'check-square'} size={20} color={colors.Text03} />
                    </View>
                </View>
            </View>
        )
    }
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 36,
        backgroundColor: 'white',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 2,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        paddingTop: 2,
    },
})
