import { colors } from '../../styles/global'
import {
    TASK_PRIORITY_COULD_DO,
    TASK_PRIORITY_DO_LATER,
    TASK_PRIORITY_MUST_DO,
    TASK_PRIORITY_SHOULD_DO,
    normalizeTaskPriority,
} from '../../../utils/TaskPriority'

export const getTaskPriorityColors = priority => {
    switch (normalizeTaskPriority(priority)) {
        case TASK_PRIORITY_MUST_DO:
            return { backgroundColor: colors.UtilityRed100, foregroundColor: colors.UtilityRed300 }
        case TASK_PRIORITY_SHOULD_DO:
            return { backgroundColor: colors.UtilityYellow125, foregroundColor: colors.UtilityYellow300 }
        case TASK_PRIORITY_COULD_DO:
            return { backgroundColor: colors.UtilityBlue125, foregroundColor: colors.UtilityBlue300 }
        case TASK_PRIORITY_DO_LATER:
            return { backgroundColor: colors.UtilityViolet125, foregroundColor: colors.UtilityViolet300 }
        default:
            return { backgroundColor: colors.Gray300, foregroundColor: colors.Text03 }
    }
}
