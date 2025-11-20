import React, { useEffect } from 'react'
import { useDispatch } from 'react-redux'

import Button from '../UIControls/Button'
import apiDrive from '../../apis/google/drive/apiDrive'
import {
    generateCustomInvoiceNumber,
    getRangeUserStatistics,
    updateInvoiceToData,
} from '../../utils/backends/firestore'
import { getEstimationTypeToUse } from '../../utils/EstimationHelper'
import { getDateRangesTimestamps } from '../StatisticsView/statisticsHelper'
import Backend from '../../utils/BackendBridge'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import store from '../../redux/store'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { startLoadingData, stopLoadingData } from '../../redux/actions'
import { createInvoiceDoc, getUsersData } from '../../apis/google/drive/invoiceGeneration'
import { createTaskWithService } from '../../utils/backends/Tasks/TaskServiceFrontendHelper'

export default function GenerateInvoice({
    fromData,
    toData,
    projectId,
    timestampsNumeric,
    timestamps,
    filterData,
    setShowGenerate,
}) {
    const dispatch = useDispatch()

    async function tryGenerateInvoice() {
        apiDrive.requestConsent(generateInvoice)
    }

    async function generateInvoice() {
        dispatch(startLoadingData())

        const { loggedUser, projectUsers } = store.getState()

        const project = ProjectHelper.getProjectById(projectId)

        let usersData = []
        const { timestamp1, timestamp2 } = getDateRangesTimestamps(filterData, false)

        const estimationTypeToUse = getEstimationTypeToUse(project.id)

        const filterByUsers = loggedUser.statisticsSelectedUsersIds[projectId]
            ? loggedUser.statisticsSelectedUsersIds[projectId]
            : [loggedUser.uid]
        const selectedUsers = projectUsers[projectId].filter(el => filterByUsers.some(f => f === el.uid))

        for (const user of selectedUsers) {
            const doneTime = await getRangeUserStatistics(
                project.id,
                estimationTypeToUse,
                user.uid,
                timestamp1,
                timestamp2
            )
            usersData.push({
                name: user.displayName,
                hourlyRate: project.hourlyRatesData?.hourlyRates[user.uid] || 0,
                time: doneTime,
            })
        }
        const times = {
            startDate: timestamps.startDate,
            endDate: timestamps.endDate,
        }

        const invoiceNumber = await generateCustomInvoiceNumber(loggedUser.uid)

        const { usersDataText, totalSum } = getUsersData(project.hourlyRatesData, usersData)
        const vatValue = fromData.vat ? totalSum * (fromData.vat / 100) : 0
        const totalMoney = (totalSum + vatValue).toFixed(2)

        const fileId = await createInvoiceDoc(
            project.id,
            project.hourlyRatesData,
            fromData,
            toData,
            times,
            invoiceNumber,
            usersDataText,
            totalSum,
            vatValue
        )

        async function createTask(docId) {
            const task = TasksHelper.getNewDefaultTask(true)
            const taskName = `Get Invoice paid (${timestampsNumeric.startDate}-${timestampsNumeric.endDate} / ${totalMoney} ${project.hourlyRatesData.currency}) https://docs.google.com/document/d/${docId}/edit`

            task.id = Backend.getId()
            task.name = taskName
            task.extendedName = taskName
            task.isPrivate = true
            task.isPublicFor = [task.userId]

            await createTaskWithService(
                {
                    projectId,
                    ...task,
                },
                {
                    awaitForTaskCreation: false,

                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            )
            setShowGenerate(false)
            dispatch(stopLoadingData())
        }

        return createTask(fileId)
    }

    function startInvoiceGeneration() {
        updateInvoiceToData(projectId, toData)
        tryGenerateInvoice().catch(err => {
            console.log(err)
        })
    }

    const onKeyDown = e => {
        if (e.key === 'Enter') startInvoiceGeneration()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })
    return <Button title={'Generate'} buttonStyle={{ alignSelf: 'center' }} onPress={startInvoiceGeneration} />
}
