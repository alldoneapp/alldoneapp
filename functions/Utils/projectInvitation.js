const admin = require('firebase-admin')
const moment = require('moment')
const SendInBlueManager = require('../SendInBlueManager')

const firebaseConfig = require('../firebaseConfig.js')
const { getUserData } = require('../Users/usersFirestore')
const { inProductionEnvironment } = require('./HelperFunctionsCloud')

// Security audit 2026-11 (NV-27): this trigger sends a mail from noreply@alldone.app to an address a
// client wrote into projectsInvitation/{projectId}/invitations/*. It used to take the answer link
// (`url`) and the inviter (`inviterId`) from that document as written, which turned it into a
// branded phishing relay. Now:
//   - the link is built here from the app URL, the project id and the invitee address, exactly as the
//     app builds it (utils/backends/firestore.js inviteUserToProject), and the stored `url` is ignored;
//   - firestore.rules bind `inviterId` to the writer, and the inviter must still be a member of the
//     project, or nothing is sent;
//   - one inviter can send at most MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY mails a day (UTC), counted
//     in the server-only projectInvitationEmailQuota collection.
const MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY = 50
const INVITATION_QUOTA_COLLECTION = 'projectInvitationEmailQuota'

// The answer route (URLSystem/People/URLsPeopleTrigger.js) takes the address unencoded as one path
// segment, so anything that could end the segment or the attribute is refused rather than escaped.
const INVITEE_EMAIL_PATTERN = /^[^\s/\\?#<>"'@]+@[^\s/\\?#<>"'@]+\.[^\s/\\?#<>"'@]+$/
const PROJECT_ID_PATTERN = /^[\w-]+$/

const normalizeEmail = value => (typeof value === 'string' ? value.trim() : '')

function buildInvitationAnswerUrl(appUrl, projectId, userEmail) {
    const base = String(appUrl || '').replace(/\/+$/, '')
    if (!base || !PROJECT_ID_PATTERN.test(projectId || '') || !INVITEE_EMAIL_PATTERN.test(userEmail || '')) return ''
    return `${base}/projects/${projectId}/contacts/${userEmail}/add`
}

async function claimInvitationEmailQuota(db, inviterId, now = Date.now()) {
    const dayKey = moment.utc(now).format('YYYY-MM-DD')
    const ref = db.doc(`${INVITATION_QUOTA_COLLECTION}/${inviterId}_${dayKey}`)
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const count = snapshot.exists ? Number(snapshot.data().count) || 0 : 0
        if (count >= MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY) return false
        transaction.set(ref, { inviterId, day: dayKey, count: count + 1, updatedAt: now }, { merge: true })
        return true
    })
}

const onCreateProjectInvitation = async (invitation, projectId, { db = admin.firestore(), now = Date.now() } = {}) => {
    const inviterId = typeof invitation?.inviterId === 'string' ? invitation.inviterId : ''
    const userEmail = normalizeEmail(invitation?.userEmail)
    if (!inviterId) return null

    const project = (await db.doc(`projects/${projectId}`).get()).data()
    if (!project) return null
    if (!Array.isArray(project.userIds) || !project.userIds.includes(inviterId)) {
        console.warn('[projectInvitation] inviter is not a member of the project, no mail sent', { projectId })
        return null
    }

    const answerURL = buildInvitationAnswerUrl(firebaseConfig.app_url, projectId, userEmail)
    if (!answerURL) {
        console.warn('[projectInvitation] invalid invitee address or project id, no mail sent', { projectId })
        return null
    }

    if (!inProductionEnvironment()) return null

    if (!(await claimInvitationEmailQuota(db, inviterId, now))) {
        console.warn('[projectInvitation] daily invitation mail limit reached, no mail sent', { projectId })
        return null
    }

    const user = await getUserData(inviterId)
    const mailData = {
        userEmail,
        inviterName: user?.displayName ? user.displayName.split(' ')[0] : 'Unknown user',
        inviterPhotoURL: user ? user.photoURL : '',
        projectName: project.name,
        answerURL,
        projectColor: project.color,
        projectDetailsURL: `project/${projectId}/properties`,
        date: moment(now).format('DD.MM.YYYY HH:mm'),
    }
    return await SendInBlueManager.sendEmailInvitationToProject(mailData)
}

module.exports = {
    onCreateProjectInvitation,
    buildInvitationAnswerUrl,
    claimInvitationEmailQuota,
    MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY,
}
