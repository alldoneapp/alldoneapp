import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import NavigationService from '../../utils/NavigationService'
import URLTrigger from '../../URLSystem/URLTrigger'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { fetchProjectOKRsHistory, getOKRRecapChat } from '../../utils/backends/OKRs/okrsFirestore'
import { OKR_STATUS_CLOSED, buildOkrRecapChatId } from '../TaskListView/OKRs/okrHelper'
import OKRHistoryRow from './OKRHistoryRow'

const itemKey = item => `${item.projectId}:${item.okr.id}`

// Loads current (active) and past (closed) OKRs for one or more projects and renders
// them in two sections. Past OKRs link to their auto-generated recap chat topic when
// one exists. Used by the project OKR tab (single project) and the settings OKR tab
// (all of the user's projects, with project names shown).
export default function OKRHistoryPanel({ projects, ownerId, showProjectName }) {
    const [items, setItems] = useState([])
    const [recapByKey, setRecapByKey] = useState({})
    const [loading, setLoading] = useState(true)

    const projectsKey = projects.map(project => project.id).join(',')

    useEffect(() => {
        let cancelled = false
        setLoading(true)

        const load = async () => {
            const lists = await Promise.all(
                projects.map(async project => {
                    const okrs = await fetchProjectOKRsHistory(project.id, ownerId)
                    return okrs.map(okr => ({ okr, projectId: project.id, projectName: project.name }))
                })
            )
            const flat = lists.flat()

            // Resolve recap topics once per closed period (multiple OKRs that closed in
            // the same period share a single recap chat), then map back to each OKR.
            const uniqueRecaps = new Map()
            flat.forEach(item => {
                if (item.okr.status !== OKR_STATUS_CLOSED) return
                const chatId = buildOkrRecapChatId(
                    item.projectId,
                    item.okr.ownerId,
                    item.okr.periodStart,
                    item.okr.periodEnd
                )
                if (chatId && !uniqueRecaps.has(chatId)) uniqueRecaps.set(chatId, item)
            })

            const resolved = await Promise.all(
                Array.from(uniqueRecaps.entries()).map(async ([chatId, item]) => {
                    const chat = await getOKRRecapChat(
                        item.projectId,
                        item.okr.ownerId,
                        item.okr.periodStart,
                        item.okr.periodEnd
                    )
                    return chat ? chatId : null
                })
            )
            const existingRecapIds = new Set(resolved.filter(Boolean))

            const recapMap = {}
            flat.forEach(item => {
                if (item.okr.status !== OKR_STATUS_CLOSED) return
                const chatId = buildOkrRecapChatId(
                    item.projectId,
                    item.okr.ownerId,
                    item.okr.periodStart,
                    item.okr.periodEnd
                )
                if (chatId && existingRecapIds.has(chatId)) recapMap[itemKey(item)] = chatId
            })

            if (cancelled) return
            setItems(flat)
            setRecapByKey(recapMap)
            setLoading(false)
        }

        load()

        return () => {
            cancelled = true
        }
    }, [projectsKey, ownerId])

    const openRecap = (projectId, chatId) => {
        URLTrigger.processUrl(NavigationService, `/projects/${projectId}/chats/${chatId}/chat`)
    }

    const current = items
        .filter(item => item.okr.status !== OKR_STATUS_CLOSED)
        .sort((a, b) => a.okr.periodEnd - b.okr.periodEnd)
    const past = items
        .filter(item => item.okr.status === OKR_STATUS_CLOSED)
        .sort((a, b) => b.okr.periodEnd - a.okr.periodEnd)

    if (loading) {
        return (
            <View style={localStyles.loadingContainer}>
                <ActivityIndicator color={colors.Primary100} />
            </View>
        )
    }

    if (current.length === 0 && past.length === 0) {
        return <Text style={localStyles.emptyText}>{translate('No OKRs yet')}</Text>
    }

    const renderRow = item => (
        <OKRHistoryRow
            key={itemKey(item)}
            okr={item.okr}
            projectName={showProjectName ? item.projectName : ''}
            recapChatId={recapByKey[itemKey(item)]}
            onOpenRecap={openRecap}
        />
    )

    return (
        <View style={localStyles.container}>
            {current.length > 0 && (
                <View style={localStyles.section}>
                    <Text style={localStyles.sectionTitle}>{translate('Current OKRs')}</Text>
                    {current.map(renderRow)}
                </View>
            )}
            {past.length > 0 && (
                <View style={localStyles.section}>
                    <Text style={localStyles.sectionTitle}>{translate('Past OKRs')}</Text>
                    {past.map(renderRow)}
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
    section: {
        marginTop: 16,
    },
    sectionTitle: {
        ...styles.subtitle2,
        color: colors.Text02,
        marginBottom: 4,
    },
    loadingContainer: {
        paddingVertical: 32,
        alignItems: 'center',
    },
    emptyText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 16,
    },
})
