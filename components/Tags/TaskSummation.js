import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'
import { getEstimationResume } from '../../utils/EstimationHelper'

const TaskSummation = ({ projectId, estimation, style, onPress, isMobile, outline, disabled }) => {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const estimationResume = getEstimationResume(projectId, estimation)

    const getText = () => {
        if (outline || smallScreenNavigation || isMobile) {
            if (estimationResume.text.startsWith('P')) {
                return ''
            } else {
                return ` ${translate(`Initial of ${estimationResume.text}`)}`
            }
        } else {
            const hours = estimationResume.hours > 0 ? ` (${estimationResume.hours} ${translate('hours')})` : ''
            return ` ${translate(estimationResume.text)}${hours}`
        }
    }

    return estimation > 0 ? (
        <TouchableOpacity onPress={onPress} disabled={disabled}>
            <View style={[(outline ? otl : localStyles).container, style]}>
                <Icon
                    name={'summation'}
                    size={outline ? 14 : 16}
                    color={outline ? colors.UtilityBlue200 : colors.Text03}
                    style={(outline ? otl : localStyles).icon}
                />
                <Text style={[(outline ? otl : localStyles).text, windowTagStyle()]}>{`${
                    estimationResume.value
                }${getText()}`}</Text>
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

export default TaskSummation
