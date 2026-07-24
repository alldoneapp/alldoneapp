const removeObjectFromBacklinks = async (projectId, property, objectId, admin) => {
    let promises = []
    promises.push(
        admin
            .firestore()
            .collection(`/items/${projectId}/tasks`)
            .where(`${property}`, 'array-contains-any', [objectId])
            .get()
    )
    promises.push(
        admin
            .firestore()
            .collection(`/noteItems/${projectId}/notes`)
            .where(`${property}`, 'array-contains-any', [objectId])
            .get()
    )
    promises.push(
        admin
            .firestore()
            .collection(`/noteItems/${projectId}/notes`)
            .where(`linkedParentsInContentIds.${property}`, 'array-contains-any', [objectId])
            .get()
    )
    promises.push(
        admin
            .firestore()
            .collection(`/noteItems/${projectId}/notes`)
            .where(`linkedParentsInTitleIds.${property}`, 'array-contains-any', [objectId])
            .get()
    )
    const [taskDocs, noteDocs, noteWithObjectInContentDocs, noteWithObjectInTitleDocs] = await Promise.all(promises)

    promises = []
    taskDocs.forEach(doc => {
        promises.push(
            admin
                .firestore()
                .doc(`items/${projectId}/tasks/${doc.id}`)
                .update({ [`${property}`]: admin.firestore.FieldValue.arrayRemove(objectId) })
        )
    })
    noteDocs.forEach(doc => {
        promises.push(
            admin
                .firestore()
                .doc(`noteItems/${projectId}/notes/${doc.id}`)
                .update({ [`${property}`]: admin.firestore.FieldValue.arrayRemove(objectId) })
        )
    })
    noteWithObjectInContentDocs.forEach(doc => {
        promises.push(
            admin
                .firestore()
                .doc(`noteItems/${projectId}/notes/${doc.id}`)
                .update({
                    [`linkedParentsInContentIds.${property}`]: admin.firestore.FieldValue.arrayRemove(objectId),
                })
        )
    })
    noteWithObjectInTitleDocs.forEach(doc => {
        promises.push(
            admin
                .firestore()
                .doc(`noteItems/${projectId}/notes/${doc.id}`)
                .update({
                    [`linkedParentsInTitleIds.${property}`]: admin.firestore.FieldValue.arrayRemove(objectId),
                })
        )
    })
    await Promise.all(promises)
}

module.exports = {
    removeObjectFromBacklinks,
}
