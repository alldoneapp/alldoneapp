import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View, Text, TextInput } from 'react-native'
import v4 from 'uuid/v4'

import styles, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { translate } from '../../../i18n/TranslationService'
import { unwatch } from '../../../utils/backends/firestore'
import {
    approveAssistantSkillImport,
    dismissAssistantSkillImport,
    importAssistantSkillsFromRepo,
    watchSkillImportJob,
} from '../../../utils/backends/AssistantSkills/assistantSkillsFirestore'

export default function ImportSkillsPanel({ skills, pendingImports }) {
    const [repoUrl, setRepoUrl] = useState('')
    const [importing, setImporting] = useState(false)
    const [resultText, setResultText] = useState('')
    const [processingImportId, setProcessingImportId] = useState('')
    const [jobProgress, setJobProgress] = useState(null)
    const jobWatcherKeyRef = useRef(null)

    const stopWatchingJob = () => {
        if (jobWatcherKeyRef.current) {
            unwatch(jobWatcherKeyRef.current)
            jobWatcherKeyRef.current = null
        }
    }

    useEffect(() => {
        return () => {
            stopWatchingJob()
        }
    }, [])

    const startImport = async () => {
        if (!repoUrl.trim() || importing) return
        setImporting(true)
        setResultText('')
        setJobProgress(null)

        // The callable reports live progress into assistantSkillImportJobs/{jobId}
        // while it runs — watch it to drive the spinner + progress bar.
        const jobId = v4()
        const watcherKey = v4()
        jobWatcherKeyRef.current = watcherKey
        watchSkillImportJob(jobId, watcherKey, setJobProgress)

        try {
            const result = await importAssistantSkillsFromRepo(repoUrl.trim(), null, jobId)
            const stagedCount = result?.staged?.length || 0
            const skippedCount = result?.skipped?.length || 0
            setResultText(
                `${translate('Skills staged for review')}: ${stagedCount}${
                    skippedCount ? ` · ${translate('Skipped')}: ${skippedCount}` : ''
                }`
            )
        } catch (error) {
            setResultText(`${translate('Import failed')}: ${error.message}`)
        } finally {
            stopWatchingJob()
            setJobProgress(null)
            setImporting(false)
        }
    }

    const approve = async stagedImport => {
        setProcessingImportId(stagedImport.uid)
        try {
            await approveAssistantSkillImport(stagedImport, skills)
        } finally {
            setProcessingImportId('')
        }
    }

    const dismiss = async stagedImport => {
        setProcessingImportId(stagedImport.uid)
        try {
            await dismissAssistantSkillImport(stagedImport.uid)
        } finally {
            setProcessingImportId('')
        }
    }

    return (
        <View style={localStyles.container}>
            <Text style={[styles.subtitle1, { color: colors.Text01 }]}>{translate('Import from repository')}</Text>
            <Text style={[styles.caption2, { color: colors.Text03, marginTop: 4 }]}>
                {translate('Import skills hint')}
            </Text>
            <View style={localStyles.inputRow}>
                <TextInput
                    value={repoUrl}
                    onChangeText={setRepoUrl}
                    style={localStyles.input}
                    placeholder={'https://github.com/anthropics/skills'}
                    autoCapitalize={'none'}
                    autoCorrect={false}
                />
                <Button
                    type={'primary'}
                    title={translate(importing ? 'Importing' : 'Import')}
                    onPress={startImport}
                    disabled={importing || !repoUrl.trim()}
                />
            </View>
            {importing && (
                <View style={localStyles.progressContainer}>
                    <View style={localStyles.progressHeader}>
                        <ActivityIndicator color={colors.Primary300} size="small" />
                        <Text style={[styles.caption2, localStyles.progressText]} numberOfLines={1}>
                            {jobProgress?.total
                                ? `${translate('Processing skill %{current} of %{total}', {
                                      current: Math.min((jobProgress.processed || 0) + 1, jobProgress.total),
                                      total: jobProgress.total,
                                  })}${jobProgress.currentSkill ? ` · ${jobProgress.currentSkill}` : ''}`
                                : translate('Contacting repository')}
                        </Text>
                    </View>
                    {!!jobProgress?.total && (
                        <View style={localStyles.progressTrack}>
                            <View
                                style={[
                                    localStyles.progressFill,
                                    {
                                        width: `${Math.min(
                                            100,
                                            Math.round(((jobProgress.processed || 0) / jobProgress.total) * 100)
                                        )}%`,
                                    },
                                ]}
                            />
                        </View>
                    )}
                </View>
            )}
            {!!resultText && (
                <Text style={[styles.caption2, { color: colors.Text02, marginTop: 8 }]}>{resultText}</Text>
            )}

            {pendingImports.length > 0 && (
                <View style={localStyles.pendingSection}>
                    <Text style={[styles.subtitle2, { color: colors.Text01, marginBottom: 8 }]}>
                        {`${translate('Pending review')} (${pendingImports.length})`}
                    </Text>
                    {pendingImports.map(stagedImport => {
                        const existing = skills.find(skill => skill.name === stagedImport.name)
                        const fileCount = stagedImport.files?.length || 0
                        const repoLabel = (stagedImport.source?.repoUrl || '').replace('https://github.com/', '')
                        const shortSha = (stagedImport.source?.sha || '').slice(0, 7)
                        const processing = processingImportId === stagedImport.uid
                        return (
                            <View key={stagedImport.uid} style={localStyles.pendingItem}>
                                <View style={localStyles.pendingItemText}>
                                    <Text style={[styles.subtitle2, { color: colors.Text01 }]} numberOfLines={1}>
                                        {stagedImport.name}
                                        <Text style={[styles.caption2, { color: colors.Text03 }]}>
                                            {`   ${repoLabel} @ ${shortSha}${
                                                fileCount ? ` · ${fileCount} ${translate('bundled files')}` : ''
                                            }`}
                                        </Text>
                                    </Text>
                                    <Text style={[styles.caption2, { color: colors.Text03 }]} numberOfLines={2}>
                                        {stagedImport.description}
                                    </Text>
                                    {!!existing && (
                                        <Text style={[styles.caption2, { color: colors.Red200 }]}>
                                            {translate('Will update existing skill')}
                                        </Text>
                                    )}
                                    {fileCount > 0 && (
                                        <Text style={[styles.caption2, { color: colors.Text03 }]}>
                                            {translate('VM only skill hint')}
                                        </Text>
                                    )}
                                </View>
                                <View style={localStyles.pendingItemActions}>
                                    <Button
                                        type={'ghost'}
                                        title={translate('Dismiss')}
                                        onPress={() => dismiss(stagedImport)}
                                        disabled={processing}
                                    />
                                    <Button
                                        type={'primary'}
                                        title={translate('Approve')}
                                        onPress={() => approve(stagedImport)}
                                        disabled={processing}
                                        buttonStyle={{ marginLeft: 8 }}
                                    />
                                </View>
                            </View>
                        )
                    })}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: colors.Grey200,
        borderRadius: 4,
        padding: 16,
        marginBottom: 16,
        backgroundColor: colors.Grey100,
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    input: {
        ...styles.body1,
        fontWeight: 400,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 4,
        borderColor: colors.Gray400,
        paddingHorizontal: 12,
        height: 40,
        flexGrow: 1,
        marginRight: 10,
        backgroundColor: '#ffffff',
    },
    progressContainer: {
        marginTop: 12,
    },
    progressHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    progressText: {
        color: colors.Text02,
        marginLeft: 8,
        flexShrink: 1,
    },
    progressTrack: {
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.Grey300,
        marginTop: 8,
        overflow: 'hidden',
    },
    progressFill: {
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.Primary300,
    },
    pendingSection: {
        marginTop: 16,
    },
    pendingItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: colors.Grey200,
    },
    pendingItemText: {
        flexShrink: 1,
        flexGrow: 1,
    },
    pendingItemActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 12,
    },
})
