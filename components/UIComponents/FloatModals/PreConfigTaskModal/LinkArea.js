import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function LinkArea({ disabled, linkInputRef, link, setLink, isValid }) {
    return (
        <View style={localStyles.section}>
            <Text style={localStyles.text}>{translate('Link')}</Text>
            <CustomTextInput3
                ref={linkInputRef}
                containerStyle={localStyles.input}
                initialTextExtended={link}
                placeholder={translate('Type the link')}
                placeholderTextColor={colors.Text03}
                multiline={true}
                onChangeText={setLink}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />
            {!isValid && !!link.trim() && <Text style={localStyles.text}>{translate('The link is invalid')}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
        marginTop: 12,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginTop: 4,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 96,
        maxHeight: 96,
    },
})
