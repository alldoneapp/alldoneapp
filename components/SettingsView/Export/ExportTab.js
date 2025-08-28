import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import global, { colors } from '../../styles/global'
import { ALL_USERS } from '../../GoalsView/GoalsHelper'
import Button from '../../UIControls/Button'
import URLsSettings from '../../../URLSystem/Settings/URLsSettings'
import { DV_TAB_SETTINGS_EXPORT } from '../../../utils/TabNavigationConstants'
import { getDb, notesStorage } from '../../../utils/backends/firestore'
import { translate } from '../../../i18n/TranslationService'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import Popover from 'react-tiny-popover'

export default function ExportTab() {
    const loggedUser = useSelector(state => state.loggedUser)
    const [isExporting, setIsExporting] = useState(false)
    const [currentExportType, setCurrentExportType] = useState(null)
    const [exportStatus, setExportStatus] = useState('')
    const [lastTasksExportInfo, setLastTasksExportInfo] = useState(null)
    const [lastNotesExportInfo, setLastNotesExportInfo] = useState(null)
    const [lastChatsExportInfo, setLastChatsExportInfo] = useState(null)
    const [lastProjectsExportInfo, setLastProjectsExportInfo] = useState(null)
    const [lastGoalsExportInfo, setLastGoalsExportInfo] = useState(null)
    const [lastContactsExportInfo, setLastContactsExportInfo] = useState(null)
    const [tasksTimeframe, setTasksTimeframe] = useState('all') // 'all' | 'today' | 'yesterday' | 'last7' | 'last30' | 'last90'
    const [tasksTfPopoverOpen, setTasksTfPopoverOpen] = useState(false)

    useEffect(() => {
        URLsSettings.push(DV_TAB_SETTINGS_EXPORT)
    }, [])

    const tasksTimeframeLabel = useMemo(() => {
        switch (tasksTimeframe) {
            case 'today':
                return 'Today'
            case 'yesterday':
                return 'Yesterday'
            case 'last7':
                return 'Last 7 days'
            case 'last30':
                return 'Last 30 days'
            case 'last90':
                return 'Last 90 days'
            default:
                return 'All time'
        }
    }, [tasksTimeframe])

    const getSelectedTimeframeRange = useCallback(() => {
        // Returns { start:number, end:number } in ms, or null for all-time
        const now = moment()
        if (tasksTimeframe === 'today') {
            return {
                start: now.clone().startOf('day').valueOf(),
                end: now.clone().endOf('day').valueOf(),
            }
        }
        if (tasksTimeframe === 'yesterday') {
            const y = now.clone().subtract(1, 'day')
            return { start: y.clone().startOf('day').valueOf(), end: y.clone().endOf('day').valueOf() }
        }
        if (tasksTimeframe === 'last7') {
            const start = now.clone().subtract(6, 'day').startOf('day').valueOf()
            const end = now.clone().endOf('day').valueOf()
            return { start, end }
        }
        if (tasksTimeframe === 'last30') {
            const start = now.clone().subtract(29, 'day').startOf('day').valueOf()
            const end = now.clone().endOf('day').valueOf()
            return { start, end }
        }
        if (tasksTimeframe === 'last90') {
            const start = now.clone().subtract(89, 'day').startOf('day').valueOf()
            const end = now.clone().endOf('day').valueOf()
            return { start, end }
        }
        return null
    }, [tasksTimeframe])

    const downloadJson = (data, filename) => {
        try {
            const jsonString = JSON.stringify(data, null, 2)
            const blob = new Blob([jsonString], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        } catch (e) {
            console.error('Failed to trigger download', e)
        }
    }

    const promisePool = async (items, limit, iterator) => {
        const results = []
        let idx = 0
        const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
            while (idx < items.length) {
                const currentIndex = idx++
                results[currentIndex] = await iterator(items[currentIndex], currentIndex)
            }
        })
        await Promise.all(workers)
        return results
    }

    const exportAllTasks = useCallback(async () => {
        if (!loggedUser?.uid) return
        setCurrentExportType('tasks')
        setIsExporting(true)
        setExportStatus('Starting export...')
        setLastTasksExportInfo(null)
        const uid = loggedUser.uid

        const db = getDb()
        const allOpenTasks = []
        const allDoneTasks = []

        try {
            const range = getSelectedTimeframeRange()
            // Fetch open tasks
            setExportStatus('Fetching open tasks...')
            let openQuery = db.collectionGroup('tasks').where('userId', '==', uid).where('inDone', '==', false)
            if (range) {
                // Include all overdue open tasks up to the end of the selected range
                openQuery = openQuery.where('dueDate', '<=', range.end)
            }
            const openSnap = await openQuery.get()
            openSnap.forEach(doc => {
                const t = doc.data()
                const projectId = doc.ref.parent.parent ? doc.ref.parent.parent.id : undefined
                allOpenTasks.push({ id: doc.id, projectId, ...t })
            })
            setExportStatus(`Open tasks fetched: ${allOpenTasks.length}`)

            // Fetch done tasks
            if (range) {
                setExportStatus('Fetching done tasks...')
                const doneSnap = await db
                    .collectionGroup('tasks')
                    .where('userId', '==', uid)
                    .where('inDone', '==', true)
                    .where('completed', '>=', range.start)
                    .where('completed', '<=', range.end)
                    .get()
                let added = 0
                doneSnap.forEach(doc => {
                    const projectId = doc.ref.parent.parent ? doc.ref.parent.parent.id : undefined
                    allDoneTasks.push({ id: doc.id, projectId, ...doc.data() })
                    added++
                })
                setExportStatus(
                    `Done tasks fetched: +${added} • totals — done: ${allDoneTasks.length} • open: ${allOpenTasks.length}`
                )
            } else {
                // All time: determine first completion date, then iterate month-by-month
                setExportStatus('Finding first done task...')
                let earliestCompletedMs = null
                try {
                    const earliestSnap = await db
                        .collectionGroup('tasks')
                        .where('userId', '==', uid)
                        .where('inDone', '==', true)
                        .orderBy('completed', 'asc')
                        .limit(1)
                        .get()
                    if (!earliestSnap.empty) {
                        const d = earliestSnap.docs[0].data()
                        if (typeof d.completed === 'number' && d.completed > 0) {
                            earliestCompletedMs = d.completed
                        }
                    }
                } catch (e) {
                    console.warn('Earliest done-task lookup failed', e)
                }

                if (earliestCompletedMs) {
                    setExportStatus('Fetching done tasks...')
                    const startCursor = moment(earliestCompletedMs).startOf('month')
                    const endCursor = moment().endOf('month')
                    const months = []
                    for (let m = startCursor.clone(); m.isSameOrBefore(endCursor, 'month'); m.add(1, 'month')) {
                        months.push({ year: m.year(), month: m.month(), label: m.format('MMM YYYY') })
                    }

                    for (let i = 0; i < months.length; i++) {
                        const { year, month, label } = months[i]
                        setExportStatus(
                            `Fetching done tasks (${i + 1}/${months.length}) — ${label} … total so far: ${
                                allDoneTasks.length
                            }`
                        )

                        const start = moment({ year, month, day: 1 }).startOf('month').valueOf()
                        const end = moment({ year, month, day: 1 }).endOf('month').valueOf()

                        const doneSnap = await db
                            .collectionGroup('tasks')
                            .where('userId', '==', uid)
                            .where('inDone', '==', true)
                            .where('completed', '>=', start)
                            .where('completed', '<=', end)
                            .get()

                        let added = 0
                        doneSnap.forEach(doc => {
                            const projectId = doc.ref.parent.parent ? doc.ref.parent.parent.id : undefined
                            allDoneTasks.push({ id: doc.id, projectId, ...doc.data() })
                            added++
                        })

                        setExportStatus(
                            `Fetched ${label}: +${added} • done so far: ${allDoneTasks.length} • open: ${allOpenTasks.length}`
                        )
                    }
                } else {
                    setExportStatus('No done tasks found; exporting open tasks only')
                }
            }

            setExportStatus('Preparing file...')
            const generatedAt = Date.now()
            const payload = {
                userId: uid,
                generatedAt,
                totals: {
                    open: allOpenTasks.length,
                    done: allDoneTasks.length,
                    total: allOpenTasks.length + allDoneTasks.length,
                },
                openTasks: allOpenTasks,
                doneTasks: allDoneTasks,
            }

            let filename = `alldone_tasks_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
            const rangeForName = getSelectedTimeframeRange()
            if (rangeForName) {
                const startStr = moment(rangeForName.start).format('YYYY-MM-DD')
                const endStr = moment(rangeForName.end).format('YYYY-MM-DD')
                filename = `alldone_tasks_${startStr}_to_${endStr}.json`
            }
            downloadJson(payload, filename)
            setLastTasksExportInfo(payload.totals)
            setExportStatus('')
            setCurrentExportType(null)
        } catch (error) {
            console.error('Error exporting tasks', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser, getSelectedTimeframeRange])

    const exportAllProjects = useCallback(async () => {
        if (!loggedUser?.uid) return
        setCurrentExportType('projects')
        setIsExporting(true)
        setExportStatus('Starting export...')
        setLastProjectsExportInfo(null)

        const uid = loggedUser.uid
        const db = getDb()

        try {
            setExportStatus('Fetching projects...')
            const snapshot = await db.collection('projects').where('userIds', 'array-contains', uid).get()

            const projects = []
            snapshot.forEach(doc => {
                projects.push({ id: doc.id, ...doc.data() })
            })

            setExportStatus('Preparing file...')
            const generatedAt = Date.now()
            const payload = {
                userId: uid,
                generatedAt,
                totals: {
                    projects: projects.length,
                },
                projects,
            }

            const filename = `alldone_projects_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
            downloadJson(payload, filename)
            setLastProjectsExportInfo(payload.totals)
            setExportStatus('')
            setCurrentExportType(null)
        } catch (error) {
            console.error('Error exporting projects', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser])

    const exportAllContacts = useCallback(async () => {
        if (!loggedUser?.uid) return
        setCurrentExportType('contacts')
        setIsExporting(true)
        setExportStatus('Starting export...')
        setLastContactsExportInfo(null)

        const uid = loggedUser.uid
        const db = getDb()

        try {
            const projectIds = loggedUser.projectIds || []
            const archivedProjectIds = loggedUser.archivedProjectIds || []
            const allProjectIds = Array.from(new Set([...projectIds, ...archivedProjectIds]))

            const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, uid]
            const allContacts = []

            setExportStatus('Fetching contacts...')
            await Promise.all(
                allProjectIds.map(async projectId => {
                    const snap = await db
                        .collection(`/projectsContacts/${projectId}/contacts`)
                        .where('isPublicFor', 'array-contains-any', allowUserIds)
                        .get()
                    snap.forEach(doc => {
                        allContacts.push({ id: doc.id, projectId, ...doc.data() })
                    })
                })
            )

            setExportStatus('Preparing file...')
            const generatedAt = Date.now()
            const payload = {
                userId: uid,
                generatedAt,
                totals: { contacts: allContacts.length },
                contacts: allContacts,
            }

            const filename = `alldone_contacts_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
            downloadJson(payload, filename)
            setLastContactsExportInfo(payload.totals)
            setExportStatus('')
            setCurrentExportType(null)
        } catch (error) {
            console.error('Error exporting contacts', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser])

    const exportAllChats = useCallback(async () => {
        if (!loggedUser?.uid) return
        setCurrentExportType('chats')
        setIsExporting(true)
        setExportStatus('Starting export...')
        setLastChatsExportInfo(null)

        const uid = loggedUser.uid
        const db = getDb()

        try {
            const projectIds = loggedUser.projectIds || []
            const archivedProjectIds = loggedUser.archivedProjectIds || []
            const allProjectIds = Array.from(new Set([...projectIds, ...archivedProjectIds]))

            const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, uid]

            const allChats = []
            let totalComments = 0
            let grandTotalChatsSoFar = 0

            for (let pIndex = 0; pIndex < allProjectIds.length; pIndex++) {
                const projectId = allProjectIds[pIndex]
                setExportStatus(`Fetching chats (${pIndex + 1}/${allProjectIds.length})...`)

                const chatsSnap = await db
                    .collection(`chatObjects/${projectId}/chats`)
                    .where('isPublicFor', 'array-contains-any', allowUserIds)
                    .get()

                const chatDocs = chatsSnap.docs
                if (chatDocs.length === 0) continue

                grandTotalChatsSoFar += chatDocs.length
                setExportStatus(
                    `Project ${pIndex + 1}/${allProjectIds.length}: found ${
                        chatDocs.length
                    } chats • total chats so far: ${grandTotalChatsSoFar}`
                )

                setExportStatus(`Fetching comments (${pIndex + 1}/${allProjectIds.length})...`)

                let processed = 0
                const totalInProject = chatDocs.length
                await promisePool(chatDocs, 6, async doc => {
                    const chatMeta = { id: doc.id, projectId, ...doc.data() }
                    const commentsSnap = await db
                        .collection(`chatComments/${projectId}/topics/${doc.id}/comments`)
                        .get()
                    const comments = []
                    commentsSnap.forEach(c => comments.push({ id: c.id, ...c.data() }))
                    chatMeta.comments = comments
                    totalComments += comments.length
                    allChats.push(chatMeta)
                    processed++
                    if (processed % 5 === 0 || processed === totalInProject) {
                        setExportStatus(
                            `Project ${pIndex + 1}/${
                                allProjectIds.length
                            }: processed ${processed}/${totalInProject} chats • chats so far: ${
                                allChats.length
                            } • comments so far: ${totalComments}`
                        )
                    }
                })
            }

            setExportStatus('Preparing file...')
            const generatedAt = Date.now()
            const payload = {
                userId: uid,
                generatedAt,
                totals: { chats: allChats.length, comments: totalComments },
                chats: allChats,
            }

            const filename = `alldone_chats_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
            downloadJson(payload, filename)
            setLastChatsExportInfo(payload.totals)
            setExportStatus('')
            setCurrentExportType(null)
        } catch (error) {
            console.error('Error exporting chats', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser])

    const exportAllGoals = useCallback(async () => {
        if (!loggedUser?.uid) return
        setCurrentExportType('goals')
        setIsExporting(true)
        setExportStatus('Starting export...')
        setLastGoalsExportInfo(null)

        const uid = loggedUser.uid
        const db = getDb()

        try {
            setExportStatus('Fetching goals...')
            const projectIds = loggedUser.projectIds || []
            const archivedProjectIds = loggedUser.archivedProjectIds || []
            const allProjectIds = Array.from(new Set([...projectIds, ...archivedProjectIds]))

            const allGoals = []
            await Promise.all(
                allProjectIds.map(async projectId => {
                    const [ownedSnap, allUsersSnap] = await Promise.all([
                        db.collection(`goals/${projectId}/items`).where('ownerId', '==', uid).get(),
                        db.collection(`goals/${projectId}/items`).where('ownerId', '==', ALL_USERS).get(),
                    ])

                    ownedSnap.forEach(doc => {
                        allGoals.push({ id: doc.id, projectId, ...doc.data() })
                    })
                    allUsersSnap.forEach(doc => {
                        allGoals.push({ id: doc.id, projectId, ...doc.data() })
                    })
                })
            )

            setExportStatus('Preparing file...')
            const generatedAt = Date.now()
            const payload = {
                userId: uid,
                generatedAt,
                totals: {
                    goals: allGoals.length,
                },
                goals: allGoals,
            }

            const filename = `alldone_goals_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
            downloadJson(payload, filename)
            setLastGoalsExportInfo(payload.totals)
            setExportStatus('')
            setCurrentExportType(null)
        } catch (error) {
            console.error('Error exporting goals', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser])

    const exportAllNotes = useCallback(async () => {
        if (!loggedUser?.uid) return
        setCurrentExportType('notes')
        setIsExporting(true)
        setExportStatus('Starting export...')
        setLastNotesExportInfo(null)

        const uid = loggedUser.uid
        const db = getDb()

        try {
            setExportStatus('Fetching notes...')
            const snap = await db.collectionGroup('notes').where('userId', '==', uid).get()

            const notes = []
            let embeddedCount = 0
            const storageRef = notesStorage ? notesStorage.ref() : null
            const contentTargets = []

            const bytesToString = uint8 => {
                let binary = ''
                const chunk = 0x8000
                for (let i = 0; i < uint8.length; i += chunk) {
                    const sub = uint8.subarray(i, i + chunk)
                    binary += String.fromCharCode.apply(null, sub)
                }
                return binary
            }
            const decodeToText = buf => {
                try {
                    if (typeof TextDecoder !== 'undefined') {
                        return new TextDecoder('utf-8').decode(new Uint8Array(buf))
                    }
                } catch (e) {}
                return bytesToString(new Uint8Array(buf))
            }

            snap.forEach(doc => {
                const projectId = doc.ref.parent.parent ? doc.ref.parent.parent.id : undefined
                const meta = { id: doc.id, projectId, ...doc.data() }
                notes.push(meta)

                if (storageRef && projectId && meta.preview) {
                    contentTargets.push({ meta, projectId, noteId: doc.id })
                }
            })

            setExportStatus(
                `Found ${notes.length} notes${
                    contentTargets.length ? `; embedding content for ${contentTargets.length}…` : ''
                }`
            )

            if (contentTargets.length > 0) {
                let processed = 0
                await promisePool(contentTargets, 6, async ({ meta, projectId, noteId }) => {
                    const primaryRef = storageRef.child(`notesData/${projectId}/${noteId}`)
                    const fallbackRef = storageRef.child(`noteDailyVersionsData/${projectId}/${noteId}`)

                    try {
                        const url = await primaryRef.getDownloadURL().catch(async () => fallbackRef.getDownloadURL())
                        const res = await fetch(url)
                        if (res.ok) {
                            const buf = await res.arrayBuffer()
                            const text = decodeToText(buf)
                            meta.content = text
                            embeddedCount++
                        }
                    } catch (err) {
                        // ignore missing files
                    } finally {
                        processed++
                        if (processed % 5 === 0 || processed === contentTargets.length) {
                            setExportStatus(
                                `Embedding note content ${processed}/${contentTargets.length} • notes: ${notes.length}`
                            )
                        }
                    }
                })
            }

            setExportStatus('Preparing file...')
            const generatedAt = Date.now()
            const payload = {
                userId: uid,
                generatedAt,
                totals: { notes: notes.length },
                notes,
            }

            const filename = `alldone_notes_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
            downloadJson(payload, filename)
            setLastNotesExportInfo({ notes: notes.length, embedded: embeddedCount })
            setExportStatus('')
            setCurrentExportType(null)
        } catch (error) {
            console.error('Error exporting notes', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser])

    return (
        <View style={{ marginBottom: 56 }}>
            <Text style={localStyles.headerText}>{translate('Export')}</Text>
            <View style={localStyles.card}>
                <Text style={localStyles.descriptionText}>{translate('Export description')}</Text>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all projects (JSON)')}
                        type="primary"
                        onPress={exportAllProjects}
                        loading={isExporting && currentExportType === 'projects'}
                    />
                    <Text style={localStyles.infoText}>
                        {currentExportType === 'projects' && isExporting
                            ? exportStatus
                            : lastProjectsExportInfo
                            ? `${translate('Last export')} — ${translate('Projects')}: ${
                                  lastProjectsExportInfo.projects
                              }`
                            : ''}
                    </Text>
                </View>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all tasks (JSON)')}
                        type="primary"
                        onPress={exportAllTasks}
                        loading={isExporting && currentExportType === 'tasks'}
                    />
                    <Popover
                        isOpen={tasksTfPopoverOpen}
                        onClickOutside={() => setTasksTfPopoverOpen(false)}
                        position={['bottom', 'left', 'right', 'top']}
                        align={'start'}
                        padding={4}
                        content={
                            <View style={localStyles.dropdownMenu}>
                                {[
                                    { key: 'all', label: translate('All time') },
                                    { key: 'today', label: translate('Today') },
                                    { key: 'yesterday', label: translate('Yesterday') },
                                    { key: 'last7', label: translate('Last 7 days') },
                                    { key: 'last30', label: translate('Last 30 days') },
                                    { key: 'last90', label: translate('Last 90 days') },
                                ].map(opt => (
                                    <Text
                                        key={opt.key}
                                        style={localStyles.dropdownItem}
                                        onPress={() => {
                                            setTasksTimeframe(opt.key)
                                            setTasksTfPopoverOpen(false)
                                        }}
                                    >
                                        {opt.label}
                                    </Text>
                                ))}
                            </View>
                        }
                    >
                        <Button
                            type={'ghost'}
                            onPress={() => setTasksTfPopoverOpen(v => !v)}
                            title={translate(tasksTimeframeLabel)}
                            buttonStyle={{ marginLeft: 12 }}
                        />
                    </Popover>
                    <Text style={localStyles.infoText}>
                        {currentExportType === 'tasks' && isExporting
                            ? exportStatus
                            : lastTasksExportInfo
                            ? `${translate('Last export')} — ${translate('Open tasks')}: ${
                                  lastTasksExportInfo.open
                              } • ${translate('Done tasks')}: ${lastTasksExportInfo.done}`
                            : ''}
                    </Text>
                </View>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all goals (JSON)')}
                        type="primary"
                        onPress={exportAllGoals}
                        loading={isExporting && currentExportType === 'goals'}
                    />
                    <Text style={localStyles.infoText}>
                        {currentExportType === 'goals' && isExporting
                            ? exportStatus
                            : lastGoalsExportInfo
                            ? `${translate('Last export')} — ${translate('Goals')}: ${lastGoalsExportInfo.goals}`
                            : ''}
                    </Text>
                </View>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all notes (JSON)')}
                        type="primary"
                        onPress={exportAllNotes}
                        loading={isExporting && currentExportType === 'notes'}
                    />
                    <Text style={localStyles.infoText}>
                        {currentExportType === 'notes' && isExporting
                            ? exportStatus
                            : lastNotesExportInfo
                            ? `${translate('Last export')} — ${translate('Notes')}: ${
                                  lastNotesExportInfo.notes
                              } • ${translate('Embedded')}: ${lastNotesExportInfo.embedded}`
                            : ''}
                    </Text>
                </View>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all contacts (JSON)')}
                        type="primary"
                        onPress={exportAllContacts}
                        loading={isExporting && currentExportType === 'contacts'}
                    />
                    <Text style={localStyles.infoText}>
                        {currentExportType === 'contacts' && isExporting
                            ? exportStatus
                            : lastContactsExportInfo
                            ? `${translate('Last export')} — ${translate('Contacts')}: ${
                                  lastContactsExportInfo.contacts
                              }`
                            : ''}
                    </Text>
                </View>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all chats (JSON)')}
                        type="primary"
                        onPress={exportAllChats}
                        loading={isExporting && currentExportType === 'chats'}
                    />
                    <Text style={localStyles.infoText}>
                        {currentExportType === 'chats' && isExporting
                            ? exportStatus
                            : lastChatsExportInfo
                            ? `${translate('Last export')} — ${translate('Chats')}: ${
                                  lastChatsExportInfo.chats
                              } • ${translate('Comments')}: ${lastChatsExportInfo.comments}`
                            : ''}
                    </Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerText: {
        ...global.title6,
        marginTop: 32,
        marginBottom: 12,
    },
    card: {
        backgroundColor: colors.Surface,
        borderRadius: 16,
        padding: 24,
        borderWidth: 1,
        borderColor: colors.Text03,
    },
    descriptionText: {
        ...global.body1,
        color: colors.Text02,
    },
    footerText: {
        ...global.caption,
        color: colors.Text02,
        marginTop: 16,
    },
    infoText: {
        ...global.caption,
        color: colors.Text02,
        marginLeft: 16,
    },
    dropdownMenu: {
        backgroundColor: colors.Surface,
        borderWidth: 1,
        borderColor: colors.Text03,
        borderRadius: 8,
        paddingVertical: 8,
        minWidth: 200,
    },
    dropdownItem: {
        ...global.body2,
        color: colors.Text01,
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
})
