import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import global, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import Switch from '../../UIControls/Switch'
import URLsSettings, { URL_SETTINGS_MCP } from '../../../URLSystem/Settings/URLsSettings'
import { translate, useTranslator } from '../../../i18n/TranslationService'
import { copyTextToClipboard } from '../../../utils/HelperFunctions'
import { setUserMCPSettings } from '../../../utils/backends/Users/usersFirestore'
import { storeLoggedUser } from '../../../redux/actions'
import { TOOL_LABEL_BY_KEY } from '../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions'

// Tools exposed over MCP, in display order. Keep in sync with
// MCP_DELEGATED_ASSISTANT_TOOLS in functions/MCP/mcpServerSimple.js — that constant
// is the server-side source of truth for what the MCP server actually serves.
const MCP_TOOL_KEYS = [
    'create_task',
    'update_task',
    'get_tasks',
    'get_focus_task',
    'create_note',
    'update_note',
    'get_notes',
    'update_contact',
    'get_contacts',
    'search',
    'get_chats',
    'get_user_projects',
    'get_updates',
    'get_goals',
    'get_project_okrs',
    'get_project_happiness',
    'update_user_memory',
    'web_search',
    'get_route_info',
    'get_chat_attachment',
    'list_recent_chat_media',
    'search_gmail',
    'get_gmail_attachment',
    'create_gmail_draft',
    'create_gmail_reply_draft',
    'update_gmail_draft',
    'update_gmail_email',
    'find_calendar_availability',
    'search_calendar_events',
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
]

// Derive the MCP server URL from the host the user is currently on so it is
// always correct for the environment (my.alldone.app, mystaging.alldone.app, …).
// The server itself is exposed at the /mcpServer path (see firebase.json rewrites).
const getMcpServerUrl = () => {
    try {
        if (typeof window !== 'undefined' && window.location && window.location.origin) {
            return `${window.location.origin}/mcpServer`
        }
    } catch (e) {}
    return 'https://my.alldone.app/mcpServer'
}

export default function MCPSettings() {
    useTranslator()
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.isMiddleScreen)
    const loggedUser = useSelector(state => state.loggedUser)
    const [copied, setCopied] = useState(false)
    const serverUrl = getMcpServerUrl()

    const mcpEnabled = loggedUser.mcpEnabled !== false
    const disabledTools = Array.isArray(loggedUser.mcpDisabledTools) ? loggedUser.mcpDisabledTools : []
    const disabledSet = new Set(disabledTools)

    useEffect(() => {
        URLsSettings.push(URL_SETTINGS_MCP)
    }, [])

    const onCopy = () => {
        copyTextToClipboard(serverUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    // Optimistically update redux so the UI reflects the change immediately, then
    // persist to the user doc (which the MCP server reads on its next request).
    const persistMcpSettings = (enabled, nextDisabledTools) => {
        dispatch(storeLoggedUser({ ...loggedUser, mcpEnabled: enabled, mcpDisabledTools: nextDisabledTools }))
        setUserMCPSettings(loggedUser.uid, enabled, nextDisabledTools)
    }

    const setMcpEnabled = enabled => persistMcpSettings(enabled, disabledTools)

    const setToolEnabled = (toolKey, enabled) => {
        const next = new Set(disabledTools)
        if (enabled) next.delete(toolKey)
        else next.add(toolKey)
        persistMcpSettings(mcpEnabled, Array.from(next))
    }

    const setAllToolsEnabled = enabled => persistMcpSettings(mcpEnabled, enabled ? [] : [...MCP_TOOL_KEYS])

    const renderStep = (index, text) => (
        <View style={localStyles.step} key={`step-${index}`}>
            <Text style={localStyles.stepNumber}>{index}</Text>
            <Text style={localStyles.stepText}>{translate(text)}</Text>
        </View>
    )

    const renderBullet = text => (
        <View style={localStyles.bullet} key={text}>
            <View style={localStyles.bulletDot} />
            <Text style={localStyles.stepText}>{translate(text)}</Text>
        </View>
    )

    return (
        <View style={localStyles.container}>
            <Text style={localStyles.headerText}>{translate('Connect Alldone via MCP')}</Text>
            <Text style={localStyles.intro}>
                {translate(
                    'Use Alldone from Claude, Codex, and other AI assistants that speak the Model Context Protocol (MCP). Connect once, then your assistant can create and update your tasks, notes, goals and contacts, search your projects, and work with your Gmail and Calendar — all inside your Alldone account.'
                )}
            </Text>

            <View style={localStyles.card}>
                <Text style={localStyles.cardLabel}>{translate('MCP server URL')}</Text>
                <View style={[localStyles.urlRow, mobile && localStyles.urlRowMobile]}>
                    <View style={[localStyles.urlBox, mobile && localStyles.urlBoxMobile]}>
                        <Text style={localStyles.urlText} selectable>
                            {serverUrl}
                        </Text>
                    </View>
                    <Button
                        type={copied ? 'secondary' : 'primary'}
                        title={translate(copied ? 'Copied' : 'Copy')}
                        onPress={onCopy}
                        buttonStyle={mobile ? localStyles.copyButtonMobile : localStyles.copyButton}
                    />
                </View>
                <Text style={localStyles.cardHelp}>
                    {translate(
                        'Add this URL as a remote MCP server in your client, then sign in with your Alldone account to authorize access.'
                    )}
                </Text>
            </View>

            <Text style={localStyles.sectionTitle}>{translate('MCP access')}</Text>
            <View style={localStyles.card}>
                <View style={localStyles.switchRow}>
                    <Text style={localStyles.switchLabel}>{translate('Enable MCP access')}</Text>
                    <Switch
                        active={mcpEnabled}
                        activeSwitch={() => setMcpEnabled(true)}
                        deactiveSwitch={() => setMcpEnabled(false)}
                    />
                </View>
                <Text style={localStyles.cardHelp}>
                    {translate(
                        'When this is off, no MCP client can use Alldone tools with your account — even one that is already connected.'
                    )}
                </Text>
            </View>

            <View style={[localStyles.card, !mcpEnabled && localStyles.cardDisabled]}>
                <View style={localStyles.toolsHeader}>
                    <Text style={localStyles.clientTitle}>{translate('Allowed tools')}</Text>
                    <View style={localStyles.toolsHeaderActions}>
                        <Button
                            type={'ghost'}
                            title={translate('Enable all')}
                            onPress={() => setAllToolsEnabled(true)}
                            disabled={!mcpEnabled}
                        />
                        <Button
                            type={'ghost'}
                            title={translate('Disable all')}
                            onPress={() => setAllToolsEnabled(false)}
                            disabled={!mcpEnabled}
                        />
                    </View>
                </View>
                <Text style={localStyles.cardHelp}>
                    {translate('Choose which tools your connected MCP clients are allowed to use.')}
                </Text>
                <View style={localStyles.toolsList}>
                    {MCP_TOOL_KEYS.map(toolKey => (
                        <View style={localStyles.toolRow} key={toolKey}>
                            <Text style={localStyles.toolLabel} numberOfLines={1}>
                                {translate(TOOL_LABEL_BY_KEY[toolKey] || toolKey)}
                            </Text>
                            <Switch
                                active={mcpEnabled && !disabledSet.has(toolKey)}
                                activeSwitch={() => setToolEnabled(toolKey, true)}
                                deactiveSwitch={() => setToolEnabled(toolKey, false)}
                                disabled={!mcpEnabled}
                            />
                        </View>
                    ))}
                </View>
            </View>

            <Text style={localStyles.sectionTitle}>{translate('How to connect')}</Text>

            <View style={localStyles.card}>
                <Text style={localStyles.clientTitle}>{translate('Claude')}</Text>
                {renderStep(1, 'Open Settings and go to Connectors (Claude web or desktop).')}
                {renderStep(2, 'Choose “Add custom connector”.')}
                {renderStep(3, 'Paste the server URL above and confirm.')}
                {renderStep(4, 'Sign in with your Alldone account in the browser window that opens.')}
            </View>

            <View style={localStyles.card}>
                <Text style={localStyles.clientTitle}>{translate('Codex')}</Text>
                {renderStep(
                    1,
                    'Add Alldone as a remote MCP server in your Codex configuration, using the server URL above.'
                )}
                {renderStep(
                    2,
                    'Run a command that uses a tool (for example, “add a task”). Codex opens a browser to authorize with your Alldone account on first use.'
                )}
            </View>

            <View style={localStyles.card}>
                <Text style={localStyles.clientTitle}>{translate('Other MCP clients')}</Text>
                {renderStep(1, 'Any client that supports remote MCP servers over HTTP with OAuth can connect.')}
                {renderStep(
                    2,
                    'Add a new remote (custom) MCP server with the URL above and authorize with your Alldone account.'
                )}
            </View>

            <Text style={localStyles.sectionTitle}>{translate('What your assistant can do')}</Text>
            <View style={localStyles.card}>
                {renderBullet('Create and manage tasks, notes, goals, OKRs and project happiness')}
                {renderBullet('Find and update contacts and search across all your projects')}
                {renderBullet('Draft and send Gmail, and manage Google Calendar events and availability')}
                {renderBullet('Search the web, look up routes, set your focus task and remember key facts')}
            </View>

            <View style={[localStyles.card, localStyles.securityCard]}>
                <Text style={localStyles.clientTitle}>{translate('Security')}</Text>
                <Text style={localStyles.cardHelp}>
                    {translate(
                        'Access uses OAuth 2.0 and acts as you — it can only see and change what your Alldone account already can. You can revoke access at any time from your MCP client.'
                    )}
                </Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        maxWidth: 760,
        paddingBottom: 40,
    },
    headerText: {
        ...global.title6,
        marginTop: 32,
        marginBottom: 12,
    },
    intro: {
        ...global.body1,
        color: colors.Text02,
        marginBottom: 24,
    },
    sectionTitle: {
        ...global.subtitle1,
        color: colors.Text01,
        marginTop: 12,
        marginBottom: 12,
    },
    card: {
        backgroundColor: colors.Surface,
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: colors.Text03,
        marginBottom: 16,
    },
    securityCard: {
        marginTop: 12,
    },
    cardDisabled: {
        opacity: 0.5,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    switchLabel: {
        ...global.subtitle2,
        color: colors.Text01,
        flex: 1,
        marginRight: 16,
    },
    toolsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    toolsHeaderActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    toolsList: {
        marginTop: 16,
    },
    toolRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: colors.Grey300,
    },
    toolLabel: {
        ...global.body1,
        color: colors.Text02,
        flex: 1,
        marginRight: 16,
    },
    cardLabel: {
        ...global.subtitle2,
        color: colors.Text01,
        marginBottom: 12,
    },
    clientTitle: {
        ...global.subtitle2,
        color: colors.Text01,
        marginBottom: 16,
    },
    urlRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    urlRowMobile: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    urlBox: {
        flex: 1,
        backgroundColor: 'white',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey400,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginRight: 12,
    },
    urlBoxMobile: {
        marginRight: 0,
        marginBottom: 12,
    },
    urlText: {
        ...global.body1,
        color: colors.Primary400,
        fontFamily: 'monospace',
    },
    copyButton: {
        minWidth: 96,
    },
    copyButtonMobile: {
        alignSelf: 'flex-start',
        minWidth: 96,
    },
    cardHelp: {
        ...global.caption,
        color: colors.Text02,
        marginTop: 12,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    stepNumber: {
        ...global.caption,
        color: 'white',
        backgroundColor: colors.Primary400,
        width: 20,
        height: 20,
        borderRadius: 10,
        textAlign: 'center',
        lineHeight: 20,
        marginRight: 12,
        overflow: 'hidden',
    },
    bullet: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 10,
    },
    bulletDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.Primary400,
        marginTop: 7,
        marginRight: 14,
        marginLeft: 7,
    },
    stepText: {
        ...global.body2,
        color: colors.Text02,
        flex: 1,
    },
})
