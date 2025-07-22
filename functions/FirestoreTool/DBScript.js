'use strict'

/**
 * Run a custom Script to update some DB Data
 *
 * @param appAdmin
 * @returns {Promise<R>}
 */
const runCustomScript = appAdmin => {
    return new Promise((resolve, reject) => {
        if (appAdmin) {
            const runScript = async (appAdmin, nextPageToken) => {
                try {
                    /* ======== PLACE YOUR CUSTOM SCRIPT CODE ABOVE HERE ======== */
                    /* Example ---------------------------------------

                    const projects = (await appAdmin.firestore().collection('projects').get()).docs
                    const projectsList = []
                    projects.forEach(projectDoc => {
                        const projectId = projectDoc.id
                        const project = projectDoc.data()
                        project.id = projectId
                        projectsList.push(project)
                    })

                    */
                    resolve(true)
                } catch (error) {
                    console.log('ERROR: Error running script:', error)
                    reject(error)
                }
            }

            runScript(appAdmin)
        } else {
            console.log('ERROR: You must pass an App Admin instance!')
        }
    })
}

module.exports = {
    runCustomScript,
}
