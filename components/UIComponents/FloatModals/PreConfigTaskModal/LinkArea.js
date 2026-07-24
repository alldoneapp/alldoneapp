import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { NEW_TOPIC_MODAL_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function LinkArea({
    disabled,
    linkInputRef,
    link,
    setLink,
    isValid,
    showDiscoveryStatus = false,
    discoveryStatus = null,
    externalIntegrationDetails = null,
}) {
    const trimmedLink = typeof link === 'string' ? link.trim() : ''
    const shouldShowStatus = showDiscoveryStatus && !!trimmedLink && isValid
    const integrationName =
        typeof externalIntegrationDetails?.integrationName === 'string'
            ? externalIntegrationDetails.integrationName
            : ''
    const manifestUrl =
        typeof externalIntegrationDetails?.manifestUrl === 'string' ? externalIntegrationDetails.manifestUrl : ''
    const discoveredTools = Array.isArray(externalIntegrationDetails?.tools) ? externalIntegrationDetails.tools : []

    const getSchemaTypeLabel = schema => {
        if (!schema || typeof schema !== 'object') return 'any'
        if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
            return (
                schema.oneOf
                    .map(option => option?.type)
                    .filter(Boolean)
                    .join(' | ') || 'any'
            )
        }
        if (schema.type === 'array') {
            const itemType = schema.items?.type || 'any'
            return `array<${itemType}>`
        }
        return schema.type || 'any'
    }

    const getToolParameters = tool => {
        const inputSchema = tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {}
        const properties =
            inputSchema.properties && typeof inputSchema.properties === 'object' ? inputSchema.properties : {}
        const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : [])

        return Object.entries(properties).map(([paramName, paramSchema]) => ({
            name: paramName,
            type: getSchemaTypeLabel(paramSchema),
            description:
                typeof paramSchema?.description === 'string' && paramSchema.description.trim()
                    ? paramSchema.description.trim()
                    : '',
            required: required.has(paramName),
        }))
    }

    const getStatusData = () => {
        if (!shouldShowStatus) return null
        if (discoveryStatus?.loading) {
            return { text: translate('Discovering external tools...'), style: localStyles.statusPending }
        }
        if (Number.isFinite(discoveryStatus?.toolsCount) && discoveryStatus.toolsCount > 0) {
            return {
                text: translate('External tools discovered count', { count: discoveryStatus.toolsCount }),
                style: localStyles.statusSuccess,
            }
        }
        if (discoveryStatus?.error) {
            return { text: translate('External tool discovery failed'), style: localStyles.statusError }
        }
        return { text: translate('External tools will be discovered on save'), style: localStyles.statusPending }
    }

    const statusData = getStatusData()

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.label}>{translate('Link')}</Text>
            <CustomTextInput3
                ref={linkInputRef}
                containerStyle={localStyles.input}
                initialTextExtended={link}
                placeholder={translate('Type the link')}
                placeholderTextColor={colors.Text03}
                multiline={true}
                onChangeText={setLink}
                styleTheme={NEW_TOPIC_MODAL_THEME}
                disabledTabKey={true}
                disabledTags={true}
                disabledEdition={disabled}
            />
            {!isValid && !!trimmedLink && <Text style={localStyles.feedback}>{translate('The link is invalid')}</Text>}
            {!!statusData && <Text style={[localStyles.feedback, statusData.style]}>{statusData.text}</Text>}
            {showDiscoveryStatus && (integrationName || manifestUrl || discoveredTools.length > 0) && (
                <View style={localStyles.detailsCard}>
                    <Text style={localStyles.detailsTitle}>{translate('Discovered app tools')}</Text>
                    {!!integrationName && (
                        <View style={localStyles.detailSection}>
                            <Text style={localStyles.detailLabel}>{translate('Integration')}</Text>
                            <Text style={localStyles.detailValue}>{integrationName}</Text>
                        </View>
                    )}
                    {!!manifestUrl && (
                        <View style={localStyles.detailSection}>
                            <Text style={localStyles.detailLabel}>{translate('Manifest URL')}</Text>
                            <Text style={localStyles.detailValue}>{manifestUrl}</Text>
                        </View>
                    )}
                    {discoveredTools.length > 0 && (
                        <View style={localStyles.detailSection}>
                            <Text style={localStyles.detailLabel}>{translate('Tool descriptions')}</Text>
                            {discoveredTools.map((tool, index) => {
                                const toolName =
                                    typeof tool?.name === 'string' && tool.name.trim()
                                        ? tool.name.trim()
                                        : typeof tool?.key === 'string' && tool.key.trim()
                                        ? tool.key.trim()
                                        : `Tool ${index + 1}`
                                const toolDescription =
                                    typeof tool?.description === 'string' ? tool.description.trim() : ''
                                const parameters = getToolParameters(tool)

                                return (
                                    <View key={`${toolName}-${index}`} style={localStyles.toolItem}>
                                        <Text style={localStyles.toolName}>{toolName}</Text>
                                        {!!toolDescription && (
                                            <Text style={localStyles.toolDescription}>{toolDescription}</Text>
                                        )}
                                        <View style={localStyles.parametersSection}>
                                            <Text style={localStyles.parametersTitle}>{translate('Parameters')}</Text>
                                            {parameters.length === 0 ? (
                                                <Text style={localStyles.emptyParametersText}>
                                                    {translate('No parameters')}
                                                </Text>
                                            ) : (
                                                parameters.map(parameter => (
                                                    <View
                                                        key={`${toolName}-${parameter.name}`}
                                                        style={localStyles.parameterItem}
                                                    >
                                                        <Text style={localStyles.parameterName}>
                                                            {parameter.name}
                                                            <Text style={localStyles.parameterMeta}>
                                                                {` (${parameter.type}, ${translate(
                                                                    parameter.required ? 'Required' : 'Optional'
                                                                )})`}
                                                            </Text>
                                                        </Text>
                                                        {!!parameter.description && (
                                                            <Text style={localStyles.parameterDescription}>
                                                                {parameter.description}
                                                            </Text>
                                                        )}
                                                    </View>
                                                ))
                                            )}
                                        </View>
                                    </View>
                                )
                            })}
                        </View>
                    )}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    section: {
        flex: 1,
        marginTop: 12,
    },
    label: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    feedback: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginTop: 4,
    },
    statusPending: {
        color: colors.Text03,
    },
    statusSuccess: {
        color: colors.Green300,
    },
    statusError: {
        color: colors.Yellow300,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        paddingVertical: 3,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        minHeight: 96,
        maxHeight: 96,
    },
    detailsCard: {
        marginTop: 12,
        padding: 12,
        borderRadius: 6,
        backgroundColor: colors.Secondary300,
        borderWidth: 1,
        borderColor: colors.Grey400,
    },
    detailsTitle: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginBottom: 8,
    },
    detailSection: {
        marginTop: 8,
    },
    detailLabel: {
        ...styles.caption2,
        color: colors.Text02,
        marginBottom: 2,
    },
    detailValue: {
        ...styles.body2,
        color: '#ffffff',
    },
    toolItem: {
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: colors.Grey400,
    },
    toolName: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginBottom: 2,
    },
    toolDescription: {
        ...styles.body2,
        color: '#d7def7',
    },
    parametersSection: {
        marginTop: 10,
    },
    parametersTitle: {
        ...styles.caption2,
        color: '#ffffff',
        marginBottom: 4,
    },
    emptyParametersText: {
        ...styles.body2,
        color: '#d7def7',
    },
    parameterItem: {
        marginTop: 6,
    },
    parameterName: {
        ...styles.body2,
        color: '#ffffff',
    },
    parameterMeta: {
        color: '#aeb9e6',
    },
    parameterDescription: {
        ...styles.caption2,
        color: '#d7def7',
        marginTop: 1,
    },
})
