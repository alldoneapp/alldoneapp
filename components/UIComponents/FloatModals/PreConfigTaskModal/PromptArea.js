import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function PromptArea({ disabled, promptInputRef, prompt, setPrompt, projectId, setMentionsModalActive }) {
    return (
        <View style={localStyles.section}>
            <Text style={localStyles.text}>{translate('Prompt')}</Text>
            <CustomTextInput3
                ref={promptInputRef}
                containerStyle={localStyles.input}
                initialTextExtended={prompt}
                placeholder={translate('Type the task prompt')}
                placeholderTextColor={colors.Text03}
                multiline={true}
                onChangeText={setPrompt}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledEdition={disabled}
                projectId={projectId}
                setMentionsModalActive={setMentionsModalActive}
            />
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
