import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import global, { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import URLsSettings from '../../../URLSystem/Settings/URLsSettings'
import { DV_TAB_SETTINGS_EXPORT } from '../../../utils/TabNavigationConstants'
import { getDb, notesStorage } from '../../../utils/backends/firestore'
import { translate } from '../../../i18n/TranslationService'

export default function ExportTab() {
    const loggedUser = useSelector(state => state.loggedUser)
    const [isExporting, setIsExporting] = useState(false)
    const [currentExportType, setCurrentExportType] = useState(null)
    const [exportStatus, setExportStatus] = useState('')
    const [lastTasksExportInfo, setLastTasksExportInfo] = useState(null)
    const [lastNotesExportInfo, setLastNotesExportInfo] = useState(null)

    useEffect(() => {
        URLsSettings.push(DV_TAB_SETTINGS_EXPORT)
    }, [])

    // Exporting all tasks, so no date range is needed

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
            setExportStatus('Fetching open tasks...')
            // Fetch all open tasks across all projects
            const openSnap = await db
                .collectionGroup('tasks')
                .where('userId', '==', uid)
                .where('inDone', '==', false)
                .get()

            openSnap.forEach(doc => {
                const t = doc.data()
                const projectId = doc.ref.parent.parent ? doc.ref.parent.parent.id : undefined
                allOpenTasks.push({ id: doc.id, projectId, ...t })
            })

            setExportStatus('Fetching done tasks...')
            // Fetch all done tasks in monthly chunks to avoid response size limits
            const earliestYear = 2015
            const currentYear = moment().year()
            for (let year = earliestYear; year <= currentYear; year++) {
                for (let month = 0; month < 12; month++) {
                    const start = moment({ year, month, day: 1 }).startOf('month').valueOf()
                    const end = moment({ year, month, day: 1 }).endOf('month').valueOf()

                    const doneSnap = await db
                        .collectionGroup('tasks')
                        .where('userId', '==', uid)
                        .where('inDone', '==', true)
                        .where('completed', '>=', start)
                        .where('completed', '<=', end)
                        .get()

                    doneSnap.forEach(doc => {
                        const projectId = doc.ref.parent.parent ? doc.ref.parent.parent.id : undefined
                        allDoneTasks.push({ id: doc.id, projectId, ...doc.data() })
                    })
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

            const filename = `alldone_tasks_all_${moment(generatedAt).format('YYYY-MM-DD')}.json`
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
    }, [loggedUser])

    const exportAllProjects = useCallback(async () => {
        if (!loggedUser?.uid) return
        setIsExporting(true)
        // Do not alter lastResultInfo as the footer refers to tasks export summary

        const uid = loggedUser.uid
        const db = getDb()

        try {
            const snapshot = await db.collection('projects').where('userIds', 'array-contains', uid).get()

            const projects = []
            snapshot.forEach(doc => {
                projects.push({ id: doc.id, ...doc.data() })
            })

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
        } catch (error) {
            console.error('Error exporting projects', error)
            alert(translate('Error exporting tasks. Please try again.'))
        } finally {
            setIsExporting(false)
        }
    }, [loggedUser])

    const exportAllNotes = useCallback(async () => {
        if (!loggedUser?.uid) return
        setIsExporting(true)

        const uid = loggedUser.uid
        const db = getDb()

        try {
            const snap = await db.collectionGroup('notes').where('userId', '==', uid).get()

            const notes = []
            let embeddedCount = 0
            const contentPromises = []
            const storageRef = notesStorage ? notesStorage.ref() : null

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
                    // Prefer proper UTF-8 decoding
                    // TextDecoder is widely supported in modern browsers
                    // Fallback to naive decoding if unavailable
                    // eslint-disable-next-line no-undef
                    if (typeof TextDecoder !== 'undefined') {
                        // eslint-disable-next-line no-undef
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
                    // Try primary path; if not found, try a lightweight HEAD check on fallback URL to avoid repeated 404 logs
                    const primaryRef = storageRef.child(`notesData/${projectId}/${doc.id}`)
                    const fallbackRef = storageRef.child(`noteDailyVersionsData/${projectId}/${doc.id}`)

                    const p = primaryRef
                        .getDownloadURL()
                        .then(url => fetch(url))
                        .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('404'))))
                        .catch(() =>
                            fallbackRef
                                .getDownloadURL()
                                .then(url => fetch(url))
                                .then(res => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('404'))))
                        )
                        .then(buf => {
                            if (buf) {
                                const text = decodeToText(buf)
                                meta.content = text
                                embeddedCount++
                            }
                        })
                        .catch(() => null)

                    contentPromises.push(p)
                }
            })

            if (contentPromises.length > 0) {
                setExportStatus('Embedding note content...')
                await Promise.all(contentPromises)
            }

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
                        loading={isExporting}
                    />
                </View>

                <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center' }}>
                    <Button
                        title={translate('Download all tasks (JSON)')}
                        type="primary"
                        onPress={exportAllTasks}
                        loading={isExporting}
                    />
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
                        title={translate('Download all notes (JSON)')}
                        type="primary"
                        onPress={exportAllNotes}
                        loading={isExporting}
                    />
                    <Text style={localStyles.infoText}>
                        {lastNotesExportInfo
                            ? `${translate('Last export')} — ${translate('Notes')}: ${
                                  lastNotesExportInfo.notes
                              } • ${translate('Embedded')}: ${lastNotesExportInfo.embedded}`
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
})
