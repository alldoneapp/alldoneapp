import TasksHelper from '../components/TaskListView/Utils/TasksHelper'

export default function useGetTaskWorkflow(projectId, task) {
    const assignee = TasksHelper.getTaskOwner(task.userId, projectId)
    return assignee?.workflow?.[projectId] || {}
}
