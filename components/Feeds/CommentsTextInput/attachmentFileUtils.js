import { translate } from '../../../i18n/TranslationService'

export const ATTACHMENT_FILE_SIZE_LIMIT_MB = 50

export const normalizeAttachmentFileName = fileName => fileName.replaceAll(/\s/g, '_')

export const addFilesAsAttachments = (files, addAttachmentTag) => {
    const addedFiles = []

    Array.from(files || []).forEach(file => {
        const fileSize = file.size / 1024 / 1024
        if (fileSize > ATTACHMENT_FILE_SIZE_LIMIT_MB) {
            alert(
                translate('File size exceeds', {
                    limit: ATTACHMENT_FILE_SIZE_LIMIT_MB,
                    size: fileSize.toFixed(2),
                })
            )
            return
        }

        const name = normalizeAttachmentFileName(file.name)
        const uri = URL.createObjectURL(file)
        addAttachmentTag(name, uri)
        addedFiles.push(file)
    })

    return addedFiles
}
