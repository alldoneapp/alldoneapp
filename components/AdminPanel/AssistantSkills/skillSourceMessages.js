import { translate } from '../../../i18n/TranslationService'

/**
 * Translation for every code `skillDraftFromSource` / `skillArchive` can raise
 * (AT-2431).
 *
 * Codes rather than pre-built strings so the parsing layer stays pure and
 * testable, and so a failure always reaches the admin as an explanation of what
 * to fix rather than as a raw `Error.message` (which for a zip failure would be
 * a byte offset). An unmapped code still renders — as the code itself — instead
 * of an empty banner.
 */
const ERROR_KEYS = {
    emptyContent: 'Skill source empty',
    bodyTooLarge: 'Skill source body too large',
    unsupportedFileType: 'Skill source unsupported file',
    readFailed: 'Skill source read failed',
    archiveTooLarge: 'Skill archive too large',
    invalidArchive: 'Skill archive invalid',
    archiveUnsupported: 'Skill archive unsupported',
    // Distinct from `archiveUnsupported`: nothing is wrong with the file, so
    // "re-create it with standard compression" would be advice that cannot work.
    archiveUnsupportedBrowser: 'Skill archive unsupported browser',
    archiveFileNameUnsupported: 'Skill archive file name unsupported',
    archiveEncrypted: 'Skill archive encrypted',
    tooManyArchiveEntries: 'Skill archive too many entries',
    noManifest: 'Skill archive no manifest',
    multipleManifests: 'Skill archive multiple manifests',
    unsafeFilePath: 'Skill bundle unsafe path',
    bundleFileTooLarge: 'Skill bundle file too large',
    tooManyBundleFiles: 'Skill bundle too many files',
    bundleTooLarge: 'Skill bundle too large',
    busy: 'Skill source busy',
}

const WARNING_KEYS = {
    noFrontmatter: 'Skill source no frontmatter',
    nameNormalized: 'Skill source name normalized',
    nameDerived: 'Skill source name derived',
    descriptionMissing: 'Skill source description missing',
    descriptionTruncated: 'Skill source description truncated',
    fileOutsideSkillFolder: 'Skill source file outside folder',
    frontmatterFieldsDropped: 'Skill source frontmatter dropped',
}

export function describeSkillSourceError(error) {
    const code = error?.code
    const key = ERROR_KEYS[code]
    if (key) return translate(key, error.params || {})
    // A failure with no code at all is a bug rather than bad input — surface the
    // raw message so it is diagnosable instead of hiding behind a generic line.
    return error?.message || translate('Skill source read failed')
}

export function describeSkillSourceWarning(warning) {
    const key = WARNING_KEYS[warning?.code]
    return key ? translate(key, warning.params || {}) : warning?.code || ''
}
