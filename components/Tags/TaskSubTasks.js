import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

const TaskSubTasks = ({ amountOfSubTasks, style, onPress, isMobile, disabled, outline }) => {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return amountOfSubTasks > 0 ? (
        <TouchableOpacity onPress={onPress} disabled={disabled}>
            <View style={[(outline ? otl : localStyles).container, style]}>
                <Icon
                    name={'list'}
                    size={outline ? 14 : 16}
                    color={outline ? colors.UtilityBlue200 : colors.Text03}
                    style={(outline ? otl : localStyles).icon}
                />
                <Text style={[(outline ? otl : localStyles).text, windowTagStyle()]}>{`${amountOfSubTasks}${
                    outline || smallScreenNavigation || isMobile
                        ? ''
                        : amountOfSubTasks <= 1
                        ? ` ${translate('Subtask')}`
                        : ` ${translate('Subtasks')}`
                }`}</Text>
            </View>
        </TouchableOpacity>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})

const otl = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderRadius: 50,
        borderWidth: 1,
        borderColor: colors.UtilityBlue200,
        alignItems: 'center',
        justifyContent: 'center',
        height: 20,
    },
    icon: {
        marginHorizontal: 3,
    },
    text: {
        ...styles.caption1,
        color: colors.UtilityBlue200,
        marginVertical: 1,
        marginRight: 6,
        marginLeft: 2,
    },
})

export default TaskSubTasks
