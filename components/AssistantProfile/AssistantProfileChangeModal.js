import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import ModalHeader from '../UIComponents/FloatModals/ModalHeader'
import CustomScrollView from '../UIControls/CustomScrollView'
import Button from '../UIControls/Button'
import WikiDiffView from '../WikiView/WikiDiffView'
import { getAssistantProfileRevisionSummary } from './revisionSummary'
import { formatWikiDate } from '../WikiView/useKnowledgeBase'
import { applyPopoverWidth } from '../../utils/HelperFunctions'
import useWindowSize from '../../utils/useWindowSize'
import { getSafeAreaModalMaxHeight } from '../../utils/modalSafeArea'
import { themed } from '../../Themes/colorMode'
import {
    getAssistantProfileRevision,
    restoreAssistantProfileRevision,
} from '../../utils/backends/AssistantProfile/assistantProfileFirestore'

const MODE_LABELS = {
    run: 'Updated automatically',
    user: 'Edited by you',
    restore: 'Restored',
}

// What one version of the assistant profile changed (AT-3072), opened from its Updates line or from
// the history in Settings → Profile. Reads the revision itself from the owner-only tree; the feed
// line carries no text. "Undo this change" puts the version before it back as a new version.
export default function AssistantProfileChangeModal({ revision, closeModal }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const [, height] = useWindowSize()
    const [state, setState] = useState({ loading: true, change: null })
    const [restore, setRestore] = useState(null)

    useEffect(() => {
        let cancelled = false
        setState({ loading: true, change: null })
        getAssistantProfileRevision(userId, revision)
            .then(change => !cancelled && setState({ loading: false, change }))
            .catch(() => !cancelled && setState({ loading: false, change: null }))
        return () => {
            cancelled = true
        }
    }, [userId, revision])

    const undo = async () => {
        setRestore('pending')
        try {
            await restoreAssistantProfileRevision(revision - 1)
            setRestore('done')
        } catch (error) {
            setRestore(error?.code === 'offline' ? 'offline' : 'failed')
        }
    }

    const { loading, change } = state
    return (
        <View
            testID="assistant-profile-change-modal"
            style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}
        >
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Assistant profile change')}
                    description={
                        change
                            ? [translate(MODE_LABELS[change.mode] || MODE_LABELS.run), formatWikiDate(change.createdAt)]
                                  .filter(Boolean)
                                  .join(' · ')
                            : ''
                    }
                />
                {loading ? (
                    <Text style={localStyles.info}>{translate('Loading')}</Text>
                ) : !change ? (
                    <Text style={localStyles.info}>{translate('This version of the profile is not available')}</Text>
                ) : (
                    <>
                        {!!getAssistantProfileRevisionSummary(change) && (
                            <Text style={localStyles.summary}>{getAssistantProfileRevisionSummary(change)}</Text>
                        )}
                        <View style={localStyles.diff}>
                            <WikiDiffView
                                before={change.previousText}
                                after={change.text}
                                testID="assistant-profile-diff"
                            />
                        </View>
                        {revision > 1 && (
                            <View style={localStyles.actions}>
                                <Button
                                    type={'secondary'}
                                    icon={'rotate-ccw'}
                                    title={translate('Undo this change')}
                                    disabled={restore === 'pending' || restore === 'done'}
                                    onPress={undo}
                                />
                            </View>
                        )}
                        {restore && restore !== 'pending' && (
                            <Text style={[localStyles.info, restore !== 'done' && localStyles.error]}>
                                {translate(
                                    restore === 'done'
                                        ? 'The previous version is back'
                                        : restore === 'offline'
                                          ? 'Assistant profile settings need a connection'
                                          : 'The previous version could not be restored'
                                )}
                            </Text>
                        )}
                    </>
                )}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: colors.Secondary400,
        boxShadow: themed.PopupShadow,
        elevation: 3,
    },
    scroll: {
        padding: 16,
        width: '100%',
    },
    info: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 8,
    },
    error: {
        color: colors.UtilityRed200,
    },
    // Popovers are dark in both modes; the Gold history writes its primary lines the same way.
    summary: {
        ...styles.body2,
        color: '#ffffff',
        marginBottom: 12,
    },
    diff: {
        backgroundColor: colors.Surface,
        borderRadius: 4,
        padding: 8,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 12,
    },
})
