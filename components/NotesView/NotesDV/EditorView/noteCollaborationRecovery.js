import * as Y from 'yjs'

const SYNC_TIMEOUT = 10000

export const waitForProviderSync = (provider, timeout = SYNC_TIMEOUT) => {
    if (provider.synced) return Promise.resolve()

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeoutHandle)
            provider.off('synced', onSynced)
        }
        const onSynced = synced => {
            if (synced) {
                cleanup()
                resolve()
            }
        }
        const timeoutHandle = setTimeout(() => {
            cleanup()
            reject(new Error('Timed out while synchronizing note content'))
        }, timeout)

        provider.on('synced', onSynced)
        if (provider.synced) onSynced(true)
    })
}

export const hasDestructiveCollaborationSync = (storedLength, syncedLength) => {
    return storedLength > 1 && syncedLength <= 1
}

export const prepareSyncedNoteDocument = async (storageData, createProvider) => {
    let document = new Y.Doc()
    let provider

    try {
        const update = new Uint8Array(storageData)
        if (update.length > 0) Y.applyUpdate(document, update)

        const storedText = document.getText('quill')
        const storedLength = storedText.length
        const storedDelta = storedText.toDelta()

        provider = createProvider(document)
        await waitForProviderSync(provider)

        let recovered = false
        if (hasDestructiveCollaborationSync(storedLength, document.getText('quill').length)) {
            const syncedText = document.getText('quill')
            document.transact(() => {
                if (syncedText.length > 0) syncedText.delete(0, syncedText.length)
                syncedText.applyDelta(storedDelta)
            }, 'storage-recovery')
            recovered = true

            if (syncedText.length !== storedLength) {
                throw new Error('Collaboration recovery did not restore the stored note content')
            }
        }

        return { document, provider, recovered }
    } catch (error) {
        provider?.destroy()
        document.destroy()
        throw error
    }
}
