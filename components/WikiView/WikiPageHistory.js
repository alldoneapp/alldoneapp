import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import {
    getKnowledgePageRevisions,
    undoKnowledgeCorrection,
} from '../../utils/backends/KnowledgeBase/knowledgeBaseFirestore'
import { formatWikiDate } from './useKnowledgeBase'

function describeRevision(revision) {
    if (revision.redacted) return translate('Revision redacted')
    if (revision.archived) return translate('Page archived')
    const name = revision.author?.name || ''
    if (revision.mode === 'correction') return `${translate('Correction by', { name })}: ${revision.reason || ''}`
    if (revision.mode === 'undo') return translate('Correction undone by', { name })
    return revision.reason || translate(revision.mode === 'rebuild' ? 'Page rebuilt' : 'Page updated')
}

// The last revisions of one page, read when the history is opened and again whenever the page gets a
// new revision: it changes at most a few times a day, so a live listener would cost more than it
// shows. A correction can be undone from here while it is still the page's latest revision — the
// same rule the assistant's undo tool follows.
export default function WikiPageHistory({ projectId, slug, currentRevision }) {
    const [revisions, setRevisions] = useState(null)
    const [failed, setFailed] = useState(false)
    const [undo, setUndo] = useState({ correctionId: null, error: '' })

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
    }, [projectId, slug, currentRevision])

    const undoCorrection = async correctionId => {
        setUndo({ correctionId, error: '' })
        try {
            await undoKnowledgeCorrection(projectId, correctionId)
            setUndo({ correctionId: null, error: '' })
        } catch (error) {
            setUndo({ correctionId: null, error: error?.message || translate('Could not undo the correction') })
        }
    }

    if (failed) return <Text style={localStyles.text}>{translate('Could not load the history')}</Text>
    if (!revisions) return <Text style={localStyles.text}>{translate('Loading history')}</Text>

    return (
        <View testID="wiki-history" style={localStyles.container}>
            {!!undo.error && <Text style={localStyles.error}>{undo.error}</Text>}
            {revisions.map(revision => {
                const correctionId = revision.author?.correctionId
                const canUndo =
                    revision.mode === 'correction' && !!correctionId && revision.revision === currentRevision
                return (
                    <View key={revision.id} style={localStyles.row}>
                        <Text style={localStyles.meta}>
                            {`${translate('Revision')} ${revision.revision} · ${formatWikiDate(revision.createdAt)}`}
                        </Text>
                        <Text style={localStyles.text}>{describeRevision(revision)}</Text>
                        {canUndo && (
                            <TouchableOpacity
                                testID={`wiki-undo-${correctionId}`}
                                disabled={!!undo.correctionId}
                                onPress={() => undoCorrection(correctionId)}
                                accessible={false}
                            >
                                <Text style={localStyles.action}>
                                    {translate(undo.correctionId === correctionId ? 'Undoing' : 'Undo correction')}
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )
            })}
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
    action: {
        ...styles.caption2,
        color: colors.Primary100,
        marginTop: 2,
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginBottom: 8,
    },
})
