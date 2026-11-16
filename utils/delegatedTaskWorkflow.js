import { withDelegationReviewStep } from '../functions/shared/delegatedTaskWorkflow'
import { translate } from '../i18n/TranslationService'

export const getDelegatedTaskWorkflow = (workflow, task) =>
    withDelegationReviewStep(workflow, task, translate('Review result'))
