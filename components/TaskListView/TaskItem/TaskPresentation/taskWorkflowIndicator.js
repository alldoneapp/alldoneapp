import { taskBypassesWorkflow } from '../../../../utils/taskExecutionMode'

// The corner marker (and, for an AI step, the play control) says "ticking this opens the workflow".
// A direct task goes straight to Done whatever its owner's workflow is, so it gets the plain checkbox.
export const shouldShowWorkflowIndicator = ({ workflow, task }) =>
    !!workflow &&
    Object.keys(workflow).length > 0 &&
    !taskBypassesWorkflow(task) &&
    task.done === false &&
    !task.parentId
