import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import FeatureModelProperty from './FeatureModelProperty'

/**
 * Settings → Customizations section: which model runs each one-shot AI feature. The features and
 * their defaults are defined once in functions/Assistant/featureModelPreferences.js — this section
 * only enumerates the rows.
 */
export default function FeatureModelsSection({ userId }) {
    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, localStyles.title]}>{translate('AI feature models')}</Text>
            <Text style={[styles.body2, localStyles.description]}>
                {translate('Choose which model runs each built-in AI feature.')}
            </Text>
            <FeatureModelProperty
                userId={userId}
                featureKey={'rambler'}
                label={'Rambler dictation'}
                helpText={'Cleans up dictated speech into coherent text.'}
                iconName={'mic'}
            />
            <FeatureModelProperty
                userId={userId}
                featureKey={'emailDraftReply'}
                label={'Email reply draft'}
                helpText={'Drafts replies to emails in your email line.'}
                iconName={'mail'}
            />
            <FeatureModelProperty
                userId={userId}
                featureKey={'emailTaskSummary'}
                label={'Task from email'}
                helpText={'Summarizes an email into a task title.'}
                iconName={'check-square'}
            />
            <FeatureModelProperty
                userId={userId}
                featureKey={'taskGoalRouting'}
                label={'Automatic goal assignment'}
                helpText={'Assigns new tasks to matching goals.'}
                iconName={'target'}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 24,
    },
    title: {
        color: colors.Text01,
    },
    description: {
        color: colors.Text03,
        marginTop: 4,
        marginBottom: 8,
    },
})
