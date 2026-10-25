import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { formatArtifactDate, formatArtifactSize, getArtifactKindIcon } from './artifactPresentation'
import { ARTIFACT_SOURCES } from '../../functions/Artifacts/artifactModel'

const SOURCE_ICONS = { [ARTIFACT_SOURCES.ASSISTANT]: 'cpu', [ARTIFACT_SOURCES.VM]: 'terminal' }

// `inCommentPopup` draws the row on the comment popup's dark header instead of the light list.
export default function ArtifactRow({ artifact, onPress, inCommentPopup = false }) {
    return (
        <TouchableOpacity
            testID={`artifact-row-${artifact.id}`}
            style={localStyles.row}
            onPress={() => onPress(artifact)}
            accessible={false}
        >
            <View style={[localStyles.icon, inCommentPopup && localStyles.iconOnDark]}>
                <Icon
                    name={getArtifactKindIcon(artifact.kind)}
                    size={20}
                    color={inCommentPopup ? colors.Grey400 : colors.Text02}
                />
            </View>
            <View style={localStyles.texts}>
                <Text style={[localStyles.title, inCommentPopup && localStyles.titleOnDark]} numberOfLines={1}>
                    {artifact.title}
                </Text>
                <Text style={[localStyles.meta, inCommentPopup && localStyles.metaOnDark]} numberOfLines={1}>
                    {translate('Artifact edited at', { date: formatArtifactDate(artifact.lastEditionDate) })}
                    {' · '}
                    {artifact.linkedUpload
                        ? `${translate('Open upload source')}: ${artifact.linkedSources[0].title || translate('File')}`
                        : formatArtifactSize(artifact.sizeBytes)}
                    {artifact.versionCount > 1
                        ? ` · ${translate('Artifact version', { number: artifact.versionCount })}`
                        : ''}
                </Text>
            </View>
            {/* What an artifact is besides its file: who made it, whether it reads live data, whether
                people are talking about it. Small and quiet, the title stays the thing to read. */}
            <View style={localStyles.badges}>
                {artifact.linkedUpload && (
                    <Icon name="link" size={14} color={badgeColor(inCommentPopup)} style={localStyles.badge} />
                )}
                {!!SOURCE_ICONS[artifact.source] && (
                    <Icon
                        name={SOURCE_ICONS[artifact.source]}
                        size={14}
                        color={badgeColor(inCommentPopup)}
                        style={localStyles.badge}
                    />
                )}
                {artifact.dataAccess && (
                    <Icon name="bar-chart-2" size={14} color={badgeColor(inCommentPopup)} style={localStyles.badge} />
                )}
                {Number(artifact.commentsData?.amount) > 0 && (
                    <View style={[localStyles.badge, localStyles.comments]}>
                        <Icon name="comments-thread" size={14} color={badgeColor(inCommentPopup)} />
                        <Text style={[localStyles.count, inCommentPopup && localStyles.metaOnDark]}>
                            {artifact.commentsData.amount}
                        </Text>
                    </View>
                )}
                {artifact.isPrivate && (
                    <Icon name="lock" size={16} color={badgeColor(inCommentPopup)} style={localStyles.badge} />
                )}
            </View>
        </TouchableOpacity>
    )
}

const badgeColor = onDark => (onDark ? colors.Grey400 : colors.Text03)

const localStyles = StyleSheet.create({
    badges: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    badge: {
        marginLeft: 8,
    },
    comments: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    count: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 4,
    },
    icon: {
        width: 32,
        height: 32,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Grey200,
        marginRight: 12,
    },
    iconOnDark: {
        backgroundColor: colors.Secondary300,
    },
    texts: {
        flex: 1,
        minWidth: 0,
        marginRight: 8,
    },
    title: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    titleOnDark: {
        color: colors.Grey100,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    metaOnDark: {
        color: colors.Grey400,
    },
})
