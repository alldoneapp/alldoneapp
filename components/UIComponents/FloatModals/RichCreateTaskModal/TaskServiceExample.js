/**
 * TaskServiceExample - Demonstrates how to refactor UI components to use TaskService
 *
 * This is an example of how existing task creation UI components can be updated
 * to use the unified TaskService while maintaining existing functionality.
 */

import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import store from '../../../../redux/store'
import { createTaskWithService } from '../../../../utils/backends/Tasks/TaskServiceFrontendHelper'
import { hideFloatPopup } from '../../../../redux/actions'

/**
 * Example component showing TaskService integration
 * This replaces the old pattern of calling uploadNewTask directly
 */
export function CreateTaskWithTaskService({ projectId, onTaskCreated, ...otherProps }) {
    const [taskName, setTaskName] = useState('')
    const [description, setDescription] = useState('')
    const [dueDate, setDueDate] = useState(Date.now())
    const [isPrivate, setIsPrivate] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(null)

    const dispatch = useDispatch()

    /**
     * Old way - direct call to uploadNewTask with manual object construction:
     *
     * const oldCreateTask = async () => {
     *     const newTask = {
     *         id: v4(),
     *         name: taskName,
     *         extendedName: taskName,
     *         description: description,
     *         userId: loggedUser.uid,
     *         dueDate: dueDate,
     *         isPrivate: isPrivate,
     *         // ... many more manual field assignments
     *     }
     *
     *     const result = await uploadNewTask(projectId, newTask, '', null, true, false, false)
     *     return result
     * }
     */

    /**
     * New way - using unified TaskService with cleaner API:
     */
    const createTask = async () => {
        setIsLoading(true)
        setError(null)

        try {
            // Use the unified TaskService approach
            const result = await createTaskWithService(
                {
                    projectId,
                    name: taskName,
                    description,
                    dueDate,
                    isPrivate,
                },
                {
                    awaitForTaskCreation: true,

                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            )

            console.log('Task created successfully:', result)

            // Notify parent component
            if (onTaskCreated) {
                onTaskCreated(result)
            }

            // Close modal
            dispatch(hideFloatPopup())

            return result
        } catch (error) {
            console.error('Task creation failed:', error)
            setError(error.message)
            throw error
        } finally {
            setIsLoading(false)
        }
    }

    const handleSubmit = async e => {
        e.preventDefault()

        if (!taskName.trim()) {
            setError('Task name is required')
            return
        }

        try {
            await createTask()
        } catch (error) {
            // Error is already logged and state is updated
        }
    }

    return (
        <div style={{ padding: '20px', maxWidth: '400px' }}>
            <h3>Create Task with TaskService</h3>
            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '15px' }}>
                    <label>
                        Task Name *
                        <input
                            type="text"
                            value={taskName}
                            onChange={e => setTaskName(e.target.value)}
                            placeholder="Enter task name..."
                            required
                            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                        />
                    </label>
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label>
                        Description
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Enter task description..."
                            rows={3}
                            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                        />
                    </label>
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label>
                        Due Date
                        <input
                            type="datetime-local"
                            value={new Date(dueDate).toISOString().slice(0, 16)}
                            onChange={e => setDueDate(new Date(e.target.value).getTime())}
                            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                        />
                    </label>
                </div>

                <div style={{ marginBottom: '15px' }}>
                    <label>
                        <input
                            type="checkbox"
                            checked={isPrivate}
                            onChange={e => setIsPrivate(e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        Private Task
                    </label>
                </div>

                {error && <div style={{ color: 'red', marginBottom: '15px', fontSize: '14px' }}>Error: {error}</div>}

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="submit"
                        disabled={isLoading || !taskName.trim()}
                        style={{
                            backgroundColor: '#007bff',
                            color: 'white',
                            border: 'none',
                            padding: '10px 20px',
                            borderRadius: '4px',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            opacity: isLoading || !taskName.trim() ? 0.6 : 1,
                        }}
                    >
                        {isLoading ? 'Creating...' : 'Create Task'}
                    </button>

                    <button
                        type="button"
                        onClick={() => dispatch(hideFloatPopup())}
                        disabled={isLoading}
                        style={{
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            padding: '10px 20px',
                            borderRadius: '4px',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            opacity: isLoading ? 0.6 : 1,
                        }}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    )
}

/**
 * Migration wrapper that shows how to gradually update existing components
 * This allows you to test the new TaskService approach alongside the existing one
 */
export function MigratedRichCreateTaskModal({ useTaskService = false, ...props }) {
    if (useTaskService) {
        return <CreateTaskWithTaskService {...props} />
    } else {
        // Use the original RichCreateTaskModal component
        const { RichCreateTaskModal } = require('./RichCreateTaskModal')
        return <RichCreateTaskModal {...props} />
    }
}

/**
 * Benefits of the new approach:
 *
 * 1. **Consistency**: All task creation uses the same logic across MCP, assistants, and UI
 * 2. **Less code**: No need to manually construct task objects with 100+ fields
 * 3. **Validation**: Built-in validation ensures data quality
 * 4. **Maintainability**: Changes to task schema only need to be made in one place
 * 5. **Testing**: Easier to test with a centralized service
 * 6. **Error handling**: Consistent error handling across all creation contexts
 *
 * Migration strategy:
 *
 * 1. Start with new components using TaskService
 * 2. Create migration helpers like TaskServiceFrontendHelper
 * 3. Gradually update existing components using feature flags
 * 4. Test thoroughly with both old and new approaches
 * 5. Remove old implementation once confident in new approach
 */

export default CreateTaskWithTaskService
