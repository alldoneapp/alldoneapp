import { client_id } from '../apisConfig'
import scriptLoader from '../../scriptLoader'
import ProfileInit from '../profileInit'

const scriptSrcGoogle = 'https://accounts.google.com/gsi/client'

const config = {
    client_id,
    scope: 'https://www.googleapis.com/auth/gmail.labels',
}

class ApiGmail {
    tokenClient = null

    constructor(config) {
        this.config = config
        this.handleClientLoad()
    }

    handleClientLoad() {
        const self = this
        scriptLoader.loadScript(scriptSrcGoogle).then(() => {
            self.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: self.config.client_id,
                scope: self.config.scope,
            })
        })
    }

    requestConsent(callback) {
        if (ProfileInit.checkAccessGranted()) {
            callback()
        } else {
            this.tokenClient.callback = callback
            this.tokenClient.requestAccessToken({ prompt: 'consent' })
        }
    }

    checkAccessGranted() {
        return ProfileInit.checkAccessGranted()
    }

    async listGmail() {
        if (gapi) {
            try {
                const res = await gapi.client.gmail.users.labels.get({
                    userId: 'me',
                    id: 'INBOX',
                })
                return res.result
            } catch (e) {
                console.error('[Gmail API] Error fetching Gmail labels:', e)
            }
        } else {
            console.error('[Gmail API] GAPI not loaded')
        }
    }
}

let apiGmail
try {
    apiGmail = new ApiGmail(config)
} catch (e) {
    console.error('[Gmail API] Error initializing:', e)
}
export default apiGmail
