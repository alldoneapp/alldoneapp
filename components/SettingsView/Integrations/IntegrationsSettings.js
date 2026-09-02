import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'
import URLsSettings, { URL_SETTINGS_INTEGRATIONS } from '../../../URLSystem/Settings/URLsSettings'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { popoverToSafePosition } from '../../../utils/HelperFunctions'
import {
    CONNECTION_SERVICE_CALENDAR,
    CONNECTION_SERVICE_EMAIL,
    PROVIDER_GOOGLE,
    PROVIDER_MICROSOFT,
    getProviderLabel,
    listCalendarConnections,
    listEmailConnections,
} from '../../../utils/IntegrationProviders'
import { runHttpsCallableFunction } from '../../../utils/backends/firestore'
import {
    hasServerSideAuth,
    revokeServerSideAuth,
    startServerSideAuth,
} from '../../../apis/google/GoogleOAuthServerSide'
import {
    hasMicrosoftServerSideAuth,
    revokeMicrosoftServerSideAuth,
    startMicrosoftServerSideAuth,
} from '../../../apis/microsoft/MicrosoftOAuthServerSide'
import ConnectionSettingsModal from './ConnectionSettingsModal'
import ProjectListModal from '../../UIComponents/FloatModals/ProjectListModal/ProjectListModal'
import AgentSubscriptionsSection from './AgentSubscriptionsSection'
import DefaultVmAgentSection from './DefaultVmAgentSection'
import IntegrationsLoadingRegion from './IntegrationsLoadingRegion'
import { brokenForDays, formatBrokenSince, getBreakageConsequenceKey, isConnectionBroken } from './connectionHealth'
import {
    HEALTH_CHECKING,
    HEALTH_CONNECTED,
    HEALTH_RECONNECT_REQUIRED,
    useConnectionHealth,
} from './useConnectionHealth'

const POPOVER_CONTAINER_STYLE = { zIndex: 10000 }

// The Google OAuth service id for a connection service ('gmail' vs 'calendar');
// Microsoft uses 'email'/'calendar' directly.
function googleServiceFor(service) {
    return service === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'gmail'
}

function microsoftServiceFor(service) {
    return service === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'email'
}

// Connecting an account REQUIRES choosing its default project. The list is
// the shared ProjectListModal (this was the plan's "hidden ninth picker").
function ProjectPickerButton({ projects, currentProjectName, onSelect, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <AppPopover
            isOpen={isOpen}
            position={['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            containerStyle={POPOVER_CONTAINER_STYLE}
            onClickOutside={() => setIsOpen(false)}
            content={
                <ProjectListModal
                    closeModal={() => setIsOpen(false)}
                    projects={projects}
                    title={translate('Choose a default project')}
                    onSelectProject={onSelect}
                />
            }
        >
            <TouchableOpacity
                style={localStyles.projectButton}
                onPress={() => setIsOpen(true)}
                disabled={disabled}
                accessibilityLabel={translate('Default project')}
            >
                <Icon name="folder" size={13} color={colors.Text03} />
                <Text style={[styles.caption1, localStyles.projectButtonText]} numberOfLines={1}>
                    {currentProjectName || translate('Choose a default project')}
                </Text>
                <Icon name="chevron-down" size={13} color={colors.Text03} />
            </TouchableOpacity>
        </AppPopover>
    )
}

// The broken-account block. Deliberately loud: the previous treatment was a 14px yellow
// "Reconnect account" line on an otherwise normal card, which is indistinguishable from a
// hint at a glance — a production account sat dead for four days with that line showing
// (AT-2491). This states what broke, what stopped working as a result, since when, and
// gives the reconnect its own primary button instead of hiding it in a text link.
export function ConnectionAuthAlert({ service, connection, onReconnect, busy, error }) {
    const since = formatBrokenSince(connection.authInvalidAt)
    const days = brokenForDays(connection.authInvalidAt)

    return (
        <View style={localStyles.alert} testID="connection-auth-alert">
            <View style={localStyles.alertHeader}>
                <Icon name="alert-circle" size={16} color={colors.UtilityRed200} />
                <Text style={[styles.subtitle2, localStyles.alertTitle]}>{translate('Reconnect required')}</Text>
            </View>
            <Text style={[styles.body2, localStyles.alertBody]}>{translate(getBreakageConsequenceKey(service))}</Text>
            {since && (
                <Text style={[styles.caption1, localStyles.alertSince]}>
                    {`${translate('Stopped working on')} ${since}`}
                    {days > 0 ? ` · ${translate('Amount days ago', { amount: days })}` : ''}
                </Text>
            )}
            {!!error && <Text style={[styles.caption1, localStyles.alertError]}>{error}</Text>}
            <Button
                title={translate('Reconnect account')}
                icon="refresh-cw"
                onPress={onReconnect}
                disabled={busy}
                processing={busy}
                processingTitle={translate('Reconnecting')}
                buttonStyle={localStyles.alertButton}
            />
        </View>
    )
}

export function ConnectionCard({ service, connection, projects, health, onReconnected }) {
    const dispatch = useDispatch()
    const [busy, setBusy] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const settingsOpenRef = useRef(false)
    const [authStatus, setAuthStatus] = useState(null)
    const [reconnectError, setReconnectError] = useState('')
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    // The stored flag is authoritative once set, but the live check can discover a dead
    // grant the flag does not know about yet — an account nobody has used since it broke.
    // `unknown` (offline, provider unreachable) deliberately proves nothing.
    const broken = isConnectionBroken(connection) || health?.status === HEALTH_RECONNECT_REQUIRED
    const isGoogle = connection.provider !== PROVIDER_MICROSOFT
    const defaultProject = projects.find(project => project.id === connection.defaultProjectId)
    // Labeling is Gmail-only; calendar routing works for both providers.
    const hasSettingsSection = service === CONNECTION_SERVICE_CALENDAR || isGoogle

    const openSettings = () => {
        if (settingsOpenRef.current) return
        settingsOpenRef.current = true
        setSettingsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeSettings = () => {
        // Closing is not idempotent: the Gmail labeling header close button
        // defers its close (see components/FollowUp/CloseButton.js), so the
        // same click can reach this handler again after the popover already
        // unmounted. A second hide under a re-opened popup would release
        // somebody else's lock; only honour the first (AT-2243).
        if (!settingsOpenRef.current) return
        // A popup that was already closed must never be able to hide the
        // global float-popup lock twice: a mouse-down on the (still visible)
        // header close button fires its close, then the button's own click
        // re-opens the settings and re-acquires the lock. With the ref
        // cleared before the dispatch, the re-open is what comes last and the
        // lock stays balanced.
        const wasOpen = settingsOpenRef.current
        settingsOpenRef.current = false
        setSettingsOpen(false)
        if (wasOpen) dispatch(hideFloatPopup())
    }

    useEffect(() => {
        return () => {
            if (settingsOpenRef.current) {
                settingsOpenRef.current = false
                dispatch(hideFloatPopup())
            }
        }
    }, [dispatch])

    useEffect(() => {
        let isMounted = true
        if (!settingsOpen || authStatus) return
        const loadStatus = async () => {
            try {
                const status = isGoogle
                    ? await hasServerSideAuth(connection.connectionId, googleServiceFor(service))
                    : await hasMicrosoftServerSideAuth(connection.connectionId, microsoftServiceFor(service))
                if (isMounted) setAuthStatus(status)
            } catch (error) {
                if (isMounted) setAuthStatus({ hasCredentials: false })
            }
        }
        loadStatus()
        return () => {
            isMounted = false
        }
    }, [settingsOpen])

    const runBusy = async (action, { onError } = {}) => {
        if (busy) return
        setBusy(true)
        try {
            await action()
        } catch (error) {
            console.error('[Integrations] Connection action failed:', error)
            // A reconnect can fail for reasons the user can act on — a blocked popup, a
            // cancelled consent screen. Swallowing that into console.error left the button
            // looking like it had simply done nothing.
            if (onError) onError(error)
        } finally {
            setBusy(false)
        }
    }

    const setDefaultProject = project =>
        runBusy(() =>
            runHttpsCallableFunction('setConnectionDefaultProjectSecondGen', {
                connectionId: connection.connectionId,
                defaultProjectId: project.id,
            })
        )

    const setDefaultAccount = () =>
        runBusy(() =>
            runHttpsCallableFunction(
                service === CONNECTION_SERVICE_CALENDAR
                    ? 'setDefaultCalendarConnectionSecondGen'
                    : 'setDefaultGmailConnectionSecondGen',
                { connectionId: connection.connectionId, isDefault: true }
            )
        )

    const reconnect = () => {
        setReconnectError('')
        return runBusy(
            async () => {
                if (isGoogle) {
                    await startServerSideAuth(
                        connection.defaultProjectId,
                        googleServiceFor(service),
                        undefined,
                        connection.connectionId
                    )
                } else {
                    await startMicrosoftServerSideAuth(
                        connection.defaultProjectId,
                        microsoftServiceFor(service),
                        undefined,
                        connection.connectionId
                    )
                }
                setAuthStatus(null)
                // Re-verify. Redux clears `authInvalid` on a fresh consent, but the health
                // result from the check that ran BEFORE the fix would otherwise keep forcing
                // this card into the reconnect state.
                if (onReconnected) onReconnected()
            },
            { onError: () => setReconnectError(translate('Reconnecting failed. Please try again.')) }
        )
    }

    const disconnect = () =>
        runBusy(async () => {
            if (isGoogle) {
                await revokeServerSideAuth(connection.connectionId, googleServiceFor(service))
            } else {
                await revokeMicrosoftServerSideAuth(connection.connectionId, microsoftServiceFor(service))
            }
        })

    return (
        <View style={[localStyles.card, broken && localStyles.cardBroken]}>
            <View style={localStyles.cardHeader}>
                <View style={localStyles.cardHeaderLeft}>
                    <Icon
                        name={service === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'mail'}
                        size={16}
                        color={broken ? colors.UtilityRed200 : colors.Text02}
                    />
                    <View style={localStyles.cardTitleArea}>
                        <View style={localStyles.cardTitleRow}>
                            <Text style={[styles.subtitle1, localStyles.cardTitle]} numberOfLines={1}>
                                {connection.email}
                            </Text>
                            {/* The status badge outranks the "Default account" one: a dead
                                default account showing only a green badge is exactly how this
                                went unnoticed. */}
                            {broken && (
                                <View style={localStyles.brokenBadge}>
                                    <Text style={[styles.caption2, localStyles.brokenBadgeText]}>
                                        {translate('Not connected')}
                                    </Text>
                                </View>
                            )}
                            {connection.isDefaultAccount && (
                                <View style={localStyles.defaultBadge}>
                                    <Text style={[styles.caption2, localStyles.defaultBadgeText]}>
                                        {translate('Default account')}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <View style={localStyles.providerRow}>
                            <Text style={[styles.caption1, localStyles.providerText]}>
                                {getProviderLabel(connection.provider)}
                            </Text>
                            {/* Live verification result. Only the two states the user can act
                                on are shown: an `unknown` answer renders nothing rather than
                                casting doubt on a mailbox that is probably fine. */}
                            {!broken && health?.status === HEALTH_CHECKING && (
                                <Text style={[styles.caption1, localStyles.checkingText]}>
                                    {` · ${translate('Checking connection')}`}
                                </Text>
                            )}
                            {!broken && health?.status === HEALTH_CONNECTED && (
                                <Text style={[styles.caption1, localStyles.connectedText]}>
                                    {` · ${translate('Connection verified')}`}
                                </Text>
                            )}
                        </View>
                    </View>
                </View>
                {busy && <ActivityIndicator size="small" color={colors.Primary100} />}
            </View>

            {broken && (
                <ConnectionAuthAlert
                    service={service}
                    connection={connection}
                    onReconnect={reconnect}
                    busy={busy}
                    error={reconnectError}
                />
            )}

            <View style={localStyles.cardControls}>
                <ProjectPickerButton
                    projects={projects}
                    currentProjectName={defaultProject?.name || connection.defaultProjectId}
                    onSelect={setDefaultProject}
                    disabled={busy}
                />
                {!connection.isDefaultAccount && (
                    <TouchableOpacity style={localStyles.textAction} onPress={setDefaultAccount} disabled={busy}>
                        <Text style={[styles.caption1, localStyles.textActionLabel]}>
                            {translate('Set as default account')}
                        </Text>
                    </TouchableOpacity>
                )}
                {hasSettingsSection && (
                    <AppPopover
                        isOpen={settingsOpen}
                        position={['right', 'bottom', 'left', 'top']}
                        padding={4}
                        windowBorderPadding={16}
                        align="end"
                        disableReposition={true}
                        onClickOutside={closeSettings}
                        contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
                        containerStyle={{
                            maxWidth: 'calc(100vw - 32px)',
                            maxHeight: 'calc(100vh - 32px)',
                            overflow: 'visible',
                            zIndex: '9999',
                        }}
                        content={
                            <ConnectionSettingsModal
                                service={service}
                                connection={connection}
                                authStatus={authStatus}
                                closePopover={closeSettings}
                            />
                        }
                    >
                        <TouchableOpacity style={localStyles.textAction} onPress={openSettings} disabled={busy}>
                            <Icon name="settings" size={13} color={colors.Primary100} />
                            <Text style={[styles.caption1, localStyles.textActionLabel]}>{translate('Settings')}</Text>
                        </TouchableOpacity>
                    </AppPopover>
                )}
                <TouchableOpacity style={localStyles.textAction} onPress={disconnect} disabled={busy}>
                    <Icon name="unlink" size={13} color={colors.UtilityRed200} />
                    <Text style={[styles.caption1, localStyles.disconnectLabel]}>
                        {translate('Disconnect account')}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    )
}

function ConnectionsSection({ service, title, connections, projects, healthByConnectionId = {}, onReconnected }) {
    const [connectPicker, setConnectPicker] = useState(null) // null | 'google' | 'microsoft'

    const connectWith = (provider, project) => {
        if (provider === PROVIDER_MICROSOFT) {
            startMicrosoftServerSideAuth(project.id, microsoftServiceFor(service)).catch(error =>
                console.error('[Integrations] Microsoft connect failed:', error)
            )
        } else {
            startServerSideAuth(project.id, googleServiceFor(service)).catch(error =>
                console.error('[Integrations] Google connect failed:', error)
            )
        }
    }

    return (
        <View style={localStyles.section}>
            <Text style={[styles.title6, localStyles.sectionTitle]}>{translate(title)}</Text>
            {connections.map(connection => (
                <ConnectionCard
                    key={connection.connectionId}
                    service={service}
                    connection={connection}
                    projects={projects}
                    health={healthByConnectionId[connection.connectionId]}
                    onReconnected={onReconnected}
                />
            ))}
            <View style={localStyles.connectRow}>
                {[PROVIDER_GOOGLE, PROVIDER_MICROSOFT].map(provider => (
                    <AppPopover
                        key={provider}
                        isOpen={connectPicker === provider}
                        position={['bottom', 'top', 'right', 'left']}
                        align="start"
                        padding={4}
                        containerStyle={POPOVER_CONTAINER_STYLE}
                        onClickOutside={() => setConnectPicker(null)}
                        content={
                            <ProjectListModal
                                projects={projects}
                                title={translate('Choose a default project')}
                                onSelectProject={project => connectWith(provider, project)}
                                closeModal={() => setConnectPicker(null)}
                            />
                        }
                    >
                        <Button
                            title={translate(provider === PROVIDER_MICROSOFT ? 'Connect Microsoft' : 'Connect Google')}
                            icon="link"
                            type="ghost"
                            buttonStyle={{ marginRight: 12 }}
                            onPress={() => setConnectPicker(provider)}
                        />
                    </AppPopover>
                ))}
            </View>
        </View>
    )
}

export default function IntegrationsSettings() {
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)

    useEffect(() => {
        URLsSettings.push(URL_SETTINGS_INTEGRATIONS)
    }, [])

    // Same active-project semantics as the default labeling config preview.
    const projects = (loggedUserProjects || []).filter(
        project => project && project.active !== false && !project.isTemplate && !project.parentTemplateId
    )
    const emailConnections = listEmailConnections(loggedUser)
    const calendarConnections = listCalendarConnections(loggedUser)

    // Verify every account against its provider when the page opens. The stored flag is
    // only written when something tried to USE the account, so an untouched connection
    // whose grant died reads as healthy until some background job stumbles on it (AT-2491).
    const { healthByConnectionId, recheck } = useConnectionHealth(
        [...emailConnections, ...calendarConnections].map(connection => connection.connectionId)
    )

    return (
        <View style={localStyles.container}>
            <Text style={[styles.body1, localStyles.description]}>{translate('IntegrationsSettingsDescription')}</Text>
            {/* One spinner for both server-fetched sections; the account lists below come from
                already-loaded Redux state and stay interactive. */}
            <IntegrationsLoadingRegion>
                <DefaultVmAgentSection />
                <AgentSubscriptionsSection />
            </IntegrationsLoadingRegion>
            <ConnectionsSection
                service={CONNECTION_SERVICE_EMAIL}
                title="Email accounts"
                connections={emailConnections}
                projects={projects}
                healthByConnectionId={healthByConnectionId}
                onReconnected={recheck}
            />
            <ConnectionsSection
                service={CONNECTION_SERVICE_CALENDAR}
                title="Calendar accounts"
                connections={calendarConnections}
                projects={projects}
                healthByConnectionId={healthByConnectionId}
                onReconnected={recheck}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 24,
        marginBottom: 48,
    },
    description: {
        color: colors.Text02,
        marginBottom: 24,
    },
    section: {
        marginBottom: 32,
    },
    sectionTitle: {
        color: colors.Text01,
        marginBottom: 12,
    },
    card: {
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    cardTitleArea: {
        marginLeft: 10,
        flex: 1,
    },
    cardTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cardTitle: {
        color: colors.Text01,
        flexShrink: 1,
    },
    defaultBadge: {
        marginLeft: 8,
        paddingHorizontal: 8,
        height: 18,
        borderRadius: 9,
        backgroundColor: colors.UtilityGreen100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    defaultBadgeText: {
        color: colors.UtilityGreen300,
    },
    providerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    providerText: {
        color: colors.Text03,
    },
    checkingText: {
        color: colors.Text03,
    },
    connectedText: {
        color: colors.UtilityGreen300,
    },
    cardBroken: {
        borderColor: colors.UtilityRed150,
        backgroundColor: colors.UtilityRed100,
    },
    brokenBadge: {
        marginLeft: 8,
        paddingHorizontal: 8,
        height: 18,
        borderRadius: 9,
        backgroundColor: colors.UtilityRed200,
        alignItems: 'center',
        justifyContent: 'center',
    },
    brokenBadgeText: {
        color: '#FFFFFF',
    },
    alert: {
        marginTop: 12,
    },
    alertHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    alertTitle: {
        color: colors.UtilityRed300,
        marginLeft: 6,
    },
    alertBody: {
        color: colors.Text01,
        marginTop: 6,
    },
    alertSince: {
        color: colors.Text02,
        marginTop: 4,
    },
    alertError: {
        color: colors.UtilityRed300,
        marginTop: 8,
    },
    alertButton: {
        marginTop: 12,
        alignSelf: 'flex-start',
    },
    cardControls: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 12,
    },
    projectButton: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.Grey400,
        marginRight: 12,
        marginBottom: 6,
        maxWidth: 240,
    },
    projectButtonText: {
        color: colors.Text02,
        marginHorizontal: 6,
        flexShrink: 1,
    },
    textAction: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        marginRight: 16,
        marginBottom: 6,
    },
    textActionLabel: {
        color: colors.Primary100,
        marginLeft: 4,
    },
    disconnectLabel: {
        color: colors.UtilityRed200,
        marginLeft: 4,
    },
    connectRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
})
