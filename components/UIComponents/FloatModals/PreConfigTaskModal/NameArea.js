import React, { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { COMMENT_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function NameArea({ disabled, nameInputRef, name, setName }) {
    useEffect(() => {
        setTimeout(() => {
            if (nameInputRef && nameInputRef.current) {
                try {
                    nameInputRef.current.focus()
                } catch (error) {
                    console.log('Failed to focus name input:', error)
                }
            }
        }, 100)
    }, [])

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.text}>{translate('Name')}</Text>
            <CustomTextInput3
                ref={nameInputRef}
                containerStyle={localStyles.input}
                initialTextExtended={name}
                placeholder={translate('Type the task name')}
                placeholderTextColor={colors.Text03}
                multiline={false}
                numberOfLines={1}
                onChangeText={setName}
                disabledTags={true}
                singleLine={true}
                styleTheme={COMMENT_MODAL_THEME}
                disabledTabKey={true}
                disabledEdition={disabled}
                autoFocus={true}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 42,
        maxHeight: 42,
    },
})
