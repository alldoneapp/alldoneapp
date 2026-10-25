import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import NavigationService from '../../utils/NavigationService'
import Icon from '../Icon'
import URLTrigger from '../../URLSystem/URLTrigger'

import { translate } from '../../i18n/TranslationService'

export default function ObjectNoteTag({ objectId, objectType, projectId, disabled, style }) {
    const onPress = () => {
        let url = `/projects/${projectId}/${objectType}/${objectId}/note`
        URLTrigger.processUrl(NavigationService, url)
    }

    return (
        <TouchableOpacity onPress={onPress} disabled={disabled} style={style}>
            <View style={localStyles.container}>
                <Icon name={'file-text'} size={16} color={colors.Text03} style={localStyles.icon} />
                <Text style={[localStyles.text, windowTagStyle()]}>{translate('Note')}</Text>
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
