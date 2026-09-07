import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

// Required lazily, exactly like `linkedEmailActions`: a static import of the backend pulls the redux
// store and the Firebase client into every suite that renders a chat message, which is how a card
// nobody is testing takes an unrelated suite down at require time.
const browserApprovalsBackend = () => require('../../../../utils/backends/Assistants/browserApprovals')

/**
 * The approval a sensitive browser action pauses on, rendered where the user is already reading:
 * under the assistant comment in which it said it needs one.
 *
 * It is modelled on `VmInteractionCard` on purpose — same card, same three answers, same wording —
 * because it is the same question ("the agent wants to do something with a consequence; may it?")
 * and a second, differently-shaped answer to it is how a user learns that approving in one place
 * does not mean what it means in the other.
 *
 * Two things it must not do. It must not offer "allow for this run" for a category the policy does
 * not allow it for — a payment, a deletion, a login and an upload are each their own irreversible
 * act, and `allowRunScope` on the request is what says so (the server refuses it as well, so this
 * is a hint rather than the control). And it must not claim the assistant resumes by itself: the
 * turn that asked has already ended, so the confirmation says to ask it to continue.
 */
function ActionButton({ label, onPress, disabled, secondary, danger }) {
    return (
        <TouchableOpacity
            style={[
                styles.button,
                secondary && styles.secondaryButton,
                danger && styles.dangerButton,
                disabled && styles.disabled,
            ]}
            onPress={onPress}
            disabled={disabled}
        >
            <Text
                style={[styles.buttonText, secondary && styles.secondaryButtonText, danger && styles.dangerButtonText]}
            >
                {label}
            </Text>
        </TouchableOpacity>
    )
}

export default function BrowserApprovalCard({ projectId, objectId, commentId }) {
    const userId = useSelector(state => state.loggedUser.uid)
    const [approvals, setApprovals] = useState([])
    const [submitting, setSubmitting] = useState('')
    const [outcome, setOutcome] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        if (!projectId || !objectId || !userId) return undefined
        return browserApprovalsBackend().watchBrowserApprovals(projectId, objectId, userId, setApprovals)
    }, [projectId, objectId, userId])

    // Only the requests raised for THIS comment. A thread can hold more than one browsing run, and a
    // card attached to the wrong comment is a request the user cannot place in the conversation.
    const pending = approvals.filter(approval => !commentId || approval.assistantCommentId === commentId)
    if (pending.length === 0 && !outcome) return null

    const answer = async (approval, action, scope) => {
        if (submitting) return
        setSubmitting(approval.approvalId)
        setError('')
        try {
            await browserApprovalsBackend().respondToBrowserApproval({
                approvalId: approval.approvalId,
                action,
                scope,
            })
            setOutcome(action === 'deny' ? 'browser_approval_denied' : 'browser_approval_approved')
        } catch (submitError) {
            setError(submitError?.message || translate('browser_approval_failed'))
        } finally {
            setSubmitting('')
        }
    }

    return (
        <View style={styles.card}>
            <Text style={styles.eyebrow}>{translate('Approval required').toUpperCase()}</Text>

            {pending.map(approval => (
                <View key={approval.approvalId} style={styles.request}>
                    <Text style={styles.message}>{approval.message}</Text>
                    {!!approval.target?.name && (
                        <Text style={styles.target} numberOfLines={2}>
                            {`“${approval.target.name}”`}
                            {approval.hostname
                                ? ` ${translate('browser_approval_on_host', { host: approval.hostname })}`
                                : ''}
                        </Text>
                    )}
                    <View style={styles.actions}>
                        <ActionButton
                            label={translate('browser_approval_allow_once')}
                            onPress={() => answer(approval, 'approve', 'once')}
                            disabled={!!submitting}
                        />
                        {/* Offered only when the policy allows a run-scoped answer for this category.
                            The server refuses it regardless, so hiding it is a courtesy, not the gate. */}
                        {approval.allowRunScope === true && (
                            <ActionButton
                                label={translate('browser_approval_allow_run')}
                                onPress={() => answer(approval, 'approve', 'run')}
                                disabled={!!submitting}
                                secondary={true}
                            />
                        )}
                        <ActionButton
                            label={translate('browser_approval_deny')}
                            onPress={() => answer(approval, 'deny')}
                            disabled={!!submitting}
                            danger={true}
                        />
                    </View>
                </View>
            ))}

            {!!outcome && <Text style={styles.outcome}>{translate(outcome)}</Text>}
            {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
    )
}

const styles = StyleSheet.create({
    card: {
        marginTop: 8,
        padding: 12,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.UtilityYellow150,
        backgroundColor: colors.Secondary400,
    },
    eyebrow: {
        color: colors.UtilityYellow200,
        fontSize: 11,
        letterSpacing: 1,
        marginBottom: 8,
    },
    request: {
        marginBottom: 8,
    },
    message: {
        color: '#FFFFFF',
    },
    target: {
        color: colors.Text03,
        marginTop: 4,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 12,
    },
    button: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 4,
        backgroundColor: colors.Primary100,
        marginRight: 8,
        marginBottom: 8,
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.Primary100,
    },
    dangerButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: colors.UtilityRed200,
    },
    disabled: {
        opacity: 0.5,
    },
    buttonText: {
        color: '#FFFFFF',
    },
    secondaryButtonText: {
        color: colors.Primary100,
    },
    dangerButtonText: {
        color: colors.UtilityRed200,
    },
    outcome: {
        color: colors.Text03,
        marginTop: 4,
    },
    error: {
        color: colors.UtilityRed200,
        marginTop: 4,
    },
})
