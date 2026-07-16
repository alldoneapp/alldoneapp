export async function completeEmailLinkedTask({ archiveEmail, archiveData, archiveEmailAction, completeTask }) {
    if (archiveEmail) {
        await archiveEmailAction(archiveData.connectionProjectId, {
            action: 'archive',
            messageIds: archiveData.messageIds,
        })
    }

    completeTask()
}
