import React from 'react'
import AttachmentsTag from '../../../FollowUp/AttachmentsTag'
import TasksHelper, { OPEN_STEP, DONE_STEP } from '../../../TaskListView/Utils/TasksHelper'
import { chronoEntriesOrder } from '../../../../utils/HelperFunctions'
import { getUserPresentationData } from '../../../ContactsView/Utils/ContactsHelper'

export default function WorkflowTag({ steps, selectedNextStep, task, projectId }) {
    const getStepDataForTag = () => {
        const assignee = TasksHelper.getTaskOwner(task.userId, projectId)
        if (selectedNextStep === OPEN_STEP) {
            return { nextStepDescription: 'Open', nextStepPhotoURL: assignee.photoURL }
        } else if (selectedNextStep === DONE_STEP) {
            return { nextStepDescription: 'Done', nextStepPhotoURL: '' }
        } else {
            const stepsData = Object.entries(steps).sort(chronoEntriesOrder)[selectedNextStep]
            return {
                nextStepDescription: stepsData[1].description,
                nextStepPhotoURL: getUserPresentationData(stepsData[1].reviewerUid).photoURL,
            }
        }
    }
    const { nextStepDescription, nextStepPhotoURL } = getStepDataForTag()
    return <AttachmentsTag text={nextStepDescription} imageUrl={nextStepPhotoURL} style={{ marginTop: 10 }} />
}
