import { isInboxSummaryGmailTask } from '../../../../utils/Gmail/gmailTaskUtils'
import { taskBypassesWorkflow } from '../../../../utils/taskExecutionMode'

/**
 * AT-2501 — may the comment popup offer the workflow steps for a task that is NOT currently
 * standing on one, i.e. an OPEN task (it has not entered the workflow yet) or a DONE task (it has
 * left it)?
 *
 * Standing on a step is self-evident proof that the task goes through the workflow, which is why
 * the middle-of-workflow case needs no rule at all. Open and done carry no such proof: every task
 * in a project whose assignee has a workflow is open at some point, and plenty of them are never
 * meant to travel through it. So the question this answers is the one the CHECKBOX already
 * answers — "would ticking this task hand it to the first reviewer, or send it straight to Done?"
 * — and the exclusions below are exactly the ones `CheckBoxWrapper.toggleCheckAction` applies
 * before bypassing the workflow, plus subtasks.
 *
 * Two of them are correctness rather than tidiness:
 *
 *   • A SUBTASK must never be offered these controls. Its `stepHistory` is COPIED from its parent
 *     (`tasksFirestore.createSubtask`, `dragTasksFirestore`), so a subtask of a task sitting on
 *     step 2 looks exactly like a task sitting on step 2 — while nothing about a subtask actually
 *     moves through the workflow: `CheckBoxWrapper` completes one with `setTaskStatus`, never with
 *     a workflow move. Worse, `moveTasksFromDone` PROMOTES a subtask to a top-level task
 *     (`promoteSubtaskToTask`), so a "reopen" tap on a done subtask would silently tear it out of
 *     its parent.
 *   • A PRIVATE task must never be offered them either: the first forward move writes the
 *     reviewer into `userIds`, i.e. it shares the task. `TaskFlowModal` guards its own workflow
 *     popup with the same `!task.isPrivate`.
 *
 * The rest — an explicit `executionMode: 'direct'`, a generated task, a calendar meeting, an
 * inbox-summary Gmail task — are tasks whose checkbox goes straight to Done, so a stepper offering
 * to send them to "First review" would contradict the row right above it.
 *
 * Note this deliberately does NOT gate the established middle-of-workflow case: a task that is
 * already standing on a step keeps its controls exactly as it has since AT-2146, whatever these
 * flags say.
 */
export const taskUsesWorkflowOutsideSteps = task => {
    if (!task) return false
    if (task.isSubtask || task.parentId) return false
    if (task.isPrivate) return false
    if (task.genericData) return false
    if (task.calendarData) return false
    // `isInboxSummaryGmailTask` accepts EITHER a task or a bare `gmailData` object and tells them
    // apart with `'gmailData' in task` — so a task object that simply has no such key is read as
    // the gmail payload itself and every ordinary task comes back "true". `mapTaskData` always
    // writes `gmailData: null`, which is why the existing call sites never see it; the explicit
    // check keeps this rule correct for any task that was not built through that mapper.
    if (task.gmailData && isInboxSummaryGmailTask(task)) return false
    return !taskBypassesWorkflow(task)
}
