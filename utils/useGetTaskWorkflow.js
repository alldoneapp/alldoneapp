import TasksHelper from '../components/TaskListView/Utils/TasksHelper'
import { getDelegatedTaskWorkflow } from './delegatedTaskWorkflow'

export default function useGetTaskWorkflow(projectId, task) {
    const assignee = TasksHelper.getTaskOwner(task.userId, projectId)
    return getDelegatedTaskWorkflow(assignee?.workflow?.[projectId] || {}, task)
}
