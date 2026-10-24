import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getKnowledgePageRevisions } from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { formatWikiDate } from './useKnowledgeBase'

// The last revisions of one page, read once when the history is opened: it changes at most a few
// times a day, so a live listener would cost more than it shows.
export default function WikiPageHistory({ projectId, slug }) {
    const [revisions, setRevisions] = useState(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setRevisions(null)
        setFailed(false)
        getKnowledgePageRevisions(projectId, slug)
            .then(result => !cancelled && setRevisions(result))
            .catch(() => !cancelled && setFailed(true))
        return () => {
            cancelled = true
        }
    }, [projectId, slug])

    if (failed) return <Text style={localStyles.text}>{translate('Could not load the history')}</Text>
    if (!revisions) return <Text style={localStyles.text}>{translate('Loading history')}</Text>

    return (
        <View testID="wiki-history" style={localStyles.container}>
            {revisions.map(revision => (
                <View key={revision.id} style={localStyles.row}>
                    <Text style={localStyles.meta}>
                        {`${translate('Revision')} ${revision.revision} · ${formatWikiDate(revision.createdAt)}`}
                    </Text>
                    <Text style={localStyles.text}>
                        {revision.redacted
                            ? translate('Revision redacted')
                            : revision.archived
                              ? translate('Page archived')
                              : revision.reason ||
                                translate(revision.mode === 'rebuild' ? 'Page rebuilt' : 'Page updated')}
                        {revision.author?.type === 'user' ? ` · ${translate('Correction')}` : ''}
                    </Text>
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 8,
        borderLeftWidth: 2,
        borderLeftColor: colors.Grey300,
        paddingLeft: 12,
    },
    row: {
        marginBottom: 8,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
    },
    text: {
        ...styles.body2,
        color: colors.Text02,
    },
})
