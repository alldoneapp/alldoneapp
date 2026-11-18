'use strict'

/**
 * AT-3071: work asked for in a project assistant's chat gets its own task.
 *
 * Anna already tracks substantial delegated work as a user-owned task (annaWorkspace.js). A project
 * assistant such as Alldone CTO answered in a plain chat (a topic) and, asked to build something,
 * ran the work, including a VM job, inside that chat. Now a chat with a project assistant behaves
 * like Anna's conversation for real work: the assistant creates a task with `trackAssistantWork`
 * (or execute_task_in_vm creates it), the work runs in that task's thread through the owner's
 * workflow, or directly when no workflow step exists (annaTaskDelegation.js), and the "ready for
 * review" notice comes back to the chat (delegationReviewNotice.js).
 *
 * Only chats: a task thread already is the task, and note, goal and contact threads keep their
 * behaviour. Automatic comment replies answer another assistant, not a member, so they are excluded.
 */

const CHAT_OBJECT_TYPES = new Set(['topics', 'chats'])

const isChatTaskTrackingConversation = runtime =>
    !!runtime &&
    CHAT_OBJECT_TYPES.has(runtime.objectType) &&
    typeof runtime.objectId === 'string' &&
    !!runtime.objectId &&
    !!runtime.requestUserId &&
    !!runtime.assistantId &&
    runtime.annaConversation !== true &&
    runtime.automaticCommentReply !== true

function chatTaskTrackingInstructions({ allowedTools = [] } = {}) {
    const tools = new Set(Array.isArray(allowedTools) ? allowedTools : [])
    const canCreateTask = tools.has('create_task')
    const canUseVm = tools.has('execute_task_in_vm')
    if (!canCreateTask && !canUseVm) return ''

    const parts = [
        'WORK REQUESTS IN THIS CHAT: this conversation is a chat, not a task. Quick questions, explanations, advice and small edits are answered here directly, without a task.',
    ]
    if (canCreateTask) {
        parts.push(
            'When the user gives you a substantial piece of work (building, implementing, fixing, researching or writing something that takes more than a quick answer, or anything you would run in the VM), track it as its own task and do the work in that task: ' +
                "call create_task once with trackAssistantWork true, taskOrigin user_request, a concise name and a description of the request in the user's language. " +
                'The user owns the task; the responsible project assistant works on it in the task thread and the result returns to the user for review. ' +
                'Follow the returned delegation status and handoffInstruction. workflow_managed means the work has already started in that task (through the saved workflow, or directly when there is no workflow step): do not also launch a VM, delegate or do the work in this chat. ' +
                'Then reply here in one or two sentences that the work continues in the task, with its link (taskUrl from the result).'
        )
    }
    if (canUseVm) {
        parts.push(
            'execute_task_in_vm called from this chat never runs in the chat: without target_task_id it creates and tracks its own task. Use either create_task with trackAssistantWork or execute_task_in_vm for the same work, never both.'
        )
    }
    parts.push(
        'If the request continues work that already has a task, continue in that existing task (for VM work pass target_task_id) instead of creating another one. ' +
            'If the user explicitly wants the answer in this chat, do it here. If it is unclear whether the request is substantial, ask.'
    )
    return parts.join(' ')
}

module.exports = { isChatTaskTrackingConversation, chatTaskTrackingInstructions }
