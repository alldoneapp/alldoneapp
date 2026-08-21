import React from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import HappinessRatingPicker from './HappinessRatingPicker'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getSafeTextValue } from '../../utils/StatisticDataHelper'
import { HAPPINESS_PRIVACY_TEXT } from '../../utils/ProjectHappinessHelper'

/**
 * The "rate every project" list, on the dark popup card (AT-2392).
 *
 * Extracted from the "new day" popup so Settings → Happiness renders the exact
 * same rows, with the exact same interactions, for a day the user picks. The
 * state and the writes live in `useProjectHappinessEditor`; this component is
 * presentational and takes that editor as its controller.
 *
 * `renderProjectMeta` is the one thing that differs between the two hosts: the
 * new-day popup shows the day's "Tasks done" count and an activity bar under
 * the project name, which is meaningless for an arbitrary past day.
 */
export default function ProjectHappinessRatingList({
    projects = [],
    editor,
    compact = false,
    renderProjectMeta,
    title = translate('Project happiness'),
    privacyText = translate(HAPPINESS_PRIVACY_TEXT),
    containerStyle,
}) {
    if (projects.length === 0) return null

    return (
        <View style={[localStyles.happinessSection, containerStyle]}>
            {!!title && <Text style={localStyles.happinessTitle}>{title}</Text>}
            {!!privacyText && <Text style={localStyles.happinessPrivacy}>{privacyText}</Text>}
            {projects.map(project => (
                <View
                    key={project.id}
                    style={[localStyles.happinessProject, compact && localStyles.mobileHappinessProject]}
                >
                    <View
                        style={[
                            localStyles.happinessProjectHeader,
                            compact && localStyles.mobileHappinessProjectHeader,
                        ]}
                    >
                        <View
                            style={[
                                localStyles.happinessProjectInfo,
                                compact && localStyles.mobileHappinessProjectInfo,
                            ]}
                        >
                            <Text style={localStyles.happinessProjectName} numberOfLines={1}>
                                {getSafeTextValue(project.name, translate('Project'))}
                            </Text>
                            {renderProjectMeta ? renderProjectMeta(project) : null}
                        </View>
                        <View style={[localStyles.happinessActions, compact && localStyles.mobileHappinessActions]}>
                            <TouchableOpacity
                                style={localStyles.commentButton}
                                testID={`happinessCommentButton_${project.id}`}
                                onPress={() => editor.toggleComment(project.id)}
                            >
                                <Icon name="message-circle" size={20} color="#ffffff" />
                            </TouchableOpacity>
                            <HappinessRatingPicker
                                value={editor.ratings[project.id]}
                                onChange={rating => editor.setRating(project, rating)}
                                compact
                                light
                            />
                        </View>
                    </View>
                    {editor.visibleComments[project.id] && (
                        <TextInput
                            ref={ref => editor.registerCommentInput(project.id, ref)}
                            testID={`happinessComment_${project.id}`}
                            style={localStyles.happinessComment}
                            multiline
                            value={editor.comments[project.id] || ''}
                            placeholder={translate('Add comment')}
                            placeholderTextColor={colors.Text03}
                            onChangeText={comment => editor.setComment(project, comment)}
                            onBlur={() => editor.saveComment(project)}
                        />
                    )}
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    happinessSection: {
        marginTop: 12,
    },
    happinessTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 4,
    },
    happinessPrivacy: {
        ...styles.body2,
        color: colors.Text04,
        marginBottom: 8,
    },
    happinessProject: {
        borderTopWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        paddingVertical: 16,
    },
    mobileHappinessProject: {
        paddingVertical: 14,
    },
    happinessProjectHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    mobileHappinessProjectHeader: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    happinessProjectInfo: {
        flex: 1,
        marginRight: 16,
        minWidth: 0,
    },
    mobileHappinessProjectInfo: {
        marginRight: 0,
        marginBottom: 10,
    },
    happinessProjectName: {
        ...styles.subtitle2,
        color: '#ffffff',
        flexShrink: 1,
    },
    happinessActions: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
    },
    mobileHappinessActions: {
        alignSelf: 'stretch',
        justifyContent: 'space-between',
    },
    commentButton: {
        width: 36,
        height: 36,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    happinessComment: {
        ...styles.body2,
        color: '#ffffff',
        minHeight: 72,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        borderRadius: 4,
        padding: 8,
        marginTop: 8,
        textAlignVertical: 'top',
    },
})
