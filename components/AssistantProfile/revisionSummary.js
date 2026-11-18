import { translate } from '../../i18n/TranslationService'

// The one line that says what a profile version changed. A nightly run writes it in the profile's
// own language; a restore is described here, in the reader's language, from the version it restored.
export function getAssistantProfileRevisionSummary(revision) {
    if (revision?.mode === 'restore' && Number.isInteger(revision.restoredFromRevision)) {
        return translate('Restored version', { revision: revision.restoredFromRevision })
    }
    return typeof revision?.summary === 'string' ? revision.summary : ''
}
