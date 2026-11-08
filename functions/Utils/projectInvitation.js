const admin = require('firebase-admin')
const moment = require('moment')
const SendInBlueManager = require('../SendInBlueManager')

const firebaseConfig = require('../firebaseConfig.js')
const { getUserData } = require('../Users/usersFirestore')
const { inProductionEnvironment } = require('./HelperFunctionsCloud')

const onCreateProjectInvitation = async (invitation, projectId) => {
    const user = await getUserData(invitation.inviterId)
    let project = (await admin.firestore().doc(`projects/${projectId}`).get()).data()

    if (!project) return

    let mailData = {
        userEmail: invitation.userEmail,
        inviterName: user ? user.displayName.split(' ')[0] : 'Unknown user',
        inviterPhotoURL: user ? user.photoURL : '',
        projectName: project.name,
        answerURL: invitation.url.replace('http://localhost:19006/', firebaseConfig.app_url),
        projectColor: project.color,
        projectDetailsURL: `project/${projectId}/properties`,
        date: moment().format('DD.MM.YYYY HH:mm'),
    }
    return inProductionEnvironment() ? await SendInBlueManager.sendEmailInvitationToProject(mailData) : null
}

module.exports = { onCreateProjectInvitation }
