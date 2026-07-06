import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import NavigationService from '../../utils/NavigationService'
import Icon from '../Icon'
import URLTrigger from '../../URLSystem/URLTrigger'
import { useDispatch } from 'react-redux'
import { startLoadingData } from '../../redux/actions'
import { translate } from '../../i18n/TranslationService'

export default function ObjectNoteTag({ objectId, objectType, projectId, disabled, style, compact }) {
    const dispatch = useDispatch()

    const onPress = () => {
        dispatch(startLoadingData())
        let url = `/projects/${projectId}/${objectType}/${objectId}/note`
        URLTrigger.processUrl(NavigationService, url)
    }

    return (
        <TouchableOpacity onPress={onPress} disabled={disabled} style={style}>
            <View style={[localStyles.container, compact && compactStyles.container]}>
                <Icon
                    name={'file-text'}
                    size={compact ? 9.6 : 16}
                    color={colors.Text03}
                    style={compact ? compactStyles.icon : localStyles.icon}
                />
                <Text style={[localStyles.text, compact && compactStyles.text, windowTagStyle()]}>
                    {translate('Note')}
                </Text>
            </View>
        </TouchableOpacity>
    )
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
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
    icon: {
        marginHorizontal: 4,
    },
})

const compactStyles = StyleSheet.create({
    container: {
        borderRadius: 7.2,
        height: 14.4,
    },
    icon: {
        marginHorizontal: 2.4,
    },
    text: {
        fontSize: 8.4,
        lineHeight: 13.2,
        marginVertical: 0.6,
        marginRight: 6,
        marginLeft: 1.2,
    },
})
