// BEGIN-ENVS
import { GOOGLE_FIREBASE_WEB_CLIENT_ID, GOOGLE_FIREBASE_WEB_API_KEY } from 'react-native-dotenv'
// END-ENVS

export const client_id = GOOGLE_FIREBASE_WEB_CLIENT_ID
export const apiKey = GOOGLE_FIREBASE_WEB_API_KEY
export const scope = 'https://www.googleapis.com/auth/calendar.events'
export const gmailScope = 'https://www.googleapis.com/auth/gmail.labels'
export const discoveryDocs = [
    'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
    'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
    'https://docs.googleapis.com/$discovery/rest?version=v1',
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    ,
]
