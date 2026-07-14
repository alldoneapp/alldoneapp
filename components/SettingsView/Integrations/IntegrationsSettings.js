import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

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
import AgentSubscriptionsSection from './AgentSubscriptionsSection'

const POPOVER_CONTAINER_STYLE = { zIndex: 10000 }

// The Google OAuth service id for a connection service ('gmail' vs 'calendar');
// Microsoft uses 'email'/'calendar' directly.
function googleServiceFor(service) {
    return service === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'gmail'
}

function microsoftServiceFor(service) {
    return service === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'email'
}

// Simple project list popover — connecting an account REQUIRES choosing its default project.
function ProjectPicker({ projects, onSelect, closePopover }) {
    return (
        <View style={localStyles.pickerContainer}>
            <Text style={[styles.subtitle2, localStyles.pickerTitle]}>{translate('Choose a default project')}</Text>
            {projects.map(project => (
                <TouchableOpacity
                    key={project.id}
                    style={localStyles.pickerRow}
                    onPress={() => {
                        closePopover()
                        onSelect(project)
                    }}
                >
                    <View style={[localStyles.projectDot, { backgroundColor: project.color || colors.Primary100 }]} />
                    <Text style={[styles.body2, localStyles.pickerRowText]} numberOfLines={1}>
                        {project.name}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    )
}

function ProjectPickerButton({ projects, currentProjectName, onSelect, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    return (
        <Popover
            isOpen={isOpen}
            position={['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            containerStyle={POPOVER_CONTAINER_STYLE}
            onClickOutside={() => setIsOpen(false)}
            content={<ProjectPicker projects={projects} onSelect={onSelect} closePopover={() => setIsOpen(false)} />}
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
        </Popover>
    )
}

function ConnectionCard({ service, connection, projects }) {
    const dispatch = useDispatch()
    const [busy, setBusy] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const settingsOpenRef = useRef(false)
    const [authStatus, setAuthStatus] = useState(null)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

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
        if (!settingsOpenRef.current) return
        settingsOpenRef.current = false
        setSettingsOpen(false)
        dispatch(hideFloatPopup())
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

    const runBusy = async action => {
        if (busy) return
        setBusy(true)
        try {
            await action()
        } catch (error) {
            console.error('[Integrations] Connection action failed:', error)
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

    const reconnect = () =>
        runBusy(async () => {
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
        })

    const disconnect = () =>
        runBusy(async () => {
            if (isGoogle) {
                await revokeServerSideAuth(connection.connectionId, googleServiceFor(service))
            } else {
                await revokeMicrosoftServerSideAuth(connection.connectionId, microsoftServiceFor(service))
            }
        })

    return (
        <View style={localStyles.card}>
            <View style={localStyles.cardHeader}>
                <View style={localStyles.cardHeaderLeft}>
                    <Icon
                        name={service === CONNECTION_SERVICE_CALENDAR ? 'calendar' : 'mail'}
                        size={16}
                        color={colors.Text02}
                    />
                    <View style={localStyles.cardTitleArea}>
                        <View style={localStyles.cardTitleRow}>
                            <Text style={[styles.subtitle1, localStyles.cardTitle]} numberOfLines={1}>
                                {connection.email}
                            </Text>
                            {connection.isDefaultAccount && (
                                <View style={localStyles.defaultBadge}>
                                    <Text style={[styles.caption2, localStyles.defaultBadgeText]}>
                                        {translate('Default account')}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <Text style={[styles.caption1, localStyles.providerText]}>
                            {getProviderLabel(connection.provider)}
                        </Text>
                    </View>
                </View>
                {busy && <ActivityIndicator size="small" color={colors.Primary100} />}
            </View>

            {connection.authInvalid && (
                <TouchableOpacity style={localStyles.reconnectBanner} onPress={reconnect} disabled={busy}>
                    <Icon name="alert-circle" size={14} color={colors.UtilityYellow300} />
                    <Text style={[styles.caption1, localStyles.reconnectText]}>{translate('Reconnect account')}</Text>
                </TouchableOpacity>
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
                    <Popover
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
                    </Popover>
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

function ConnectionsSection({ service, title, connections, projects }) {
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
                />
            ))}
            <View style={localStyles.connectRow}>
                {[PROVIDER_GOOGLE, PROVIDER_MICROSOFT].map(provider => (
                    <Popover
                        key={provider}
                        isOpen={connectPicker === provider}
                        position={['bottom', 'top', 'right', 'left']}
                        align="start"
                        padding={4}
                        containerStyle={POPOVER_CONTAINER_STYLE}
                        onClickOutside={() => setConnectPicker(null)}
                        content={
                            <ProjectPicker
                                projects={projects}
                                onSelect={project => connectWith(provider, project)}
                                closePopover={() => setConnectPicker(null)}
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
                    </Popover>
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

    return (
        <View style={localStyles.container}>
            <Text style={[styles.body1, localStyles.description]}>{translate('IntegrationsSettingsDescription')}</Text>
            <AgentSubscriptionsSection />
            <ConnectionsSection
                service={CONNECTION_SERVICE_EMAIL}
                title="Email accounts"
                connections={emailConnections}
                projects={projects}
            />
            <ConnectionsSection
                service={CONNECTION_SERVICE_CALENDAR}
                title="Calendar accounts"
                connections={calendarConnections}
                projects={projects}
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
    providerText: {
        color: colors.Text03,
    },
    reconnectBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 10,
    },
    reconnectText: {
        color: colors.UtilityYellow300,
        marginLeft: 6,
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
    pickerContainer: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingVertical: 8,
        paddingHorizontal: 8,
        minWidth: 220,
        maxWidth: 280,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    pickerTitle: {
        color: '#ffffff',
        paddingHorizontal: 8,
        paddingVertical: 6,
    },
    pickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        height: 36,
        borderRadius: 4,
    },
    projectDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 8,
    },
    pickerRowText: {
        color: '#ffffff',
        flexShrink: 1,
    },
})
