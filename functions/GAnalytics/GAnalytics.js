'use strict'
const { fetchUrl: fetch } = require('fetch')
const functions = require('firebase-functions')

const { app_name } = require('./../firebaseConfig')
const { getEnvFunctions } = require('../envFunctionsHelper')

const purchaseEvent = async (userId, value, subscriptionId) => {
    const {
        GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET,
        GOOGLE_ANALYTICS_KEY,
        GOOGLE_FIREBASE_WEB_CLIENT_ID,
    } = getEnvFunctions()

    if (!GOOGLE_ANALYTICS_KEY || !GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET) return

    const api_secret = GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET
    await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${GOOGLE_ANALYTICS_KEY}&api_secret=${api_secret}`,
        {
            method: 'POST',
            payload: JSON.stringify({
                client_id: GOOGLE_FIREBASE_WEB_CLIENT_ID,
                user_id: userId,
                events: [
                    {
                        name: 'successful_payment',
                        params: {
                            uid: userId,
                            currency: 'EUR',
                            value: value,
                            transaction_id: subscriptionId,
                            affiliation: 'Mollie',
                            app_name: app_name,
                        },
                    },
                ],
            }),
        },
        function (error, meta, body) {
            if (error) {
                functions.logger.error(error)
            }
            functions.logger.log(meta.status)
        }
    )
}

const logEvent = async (userId, name, params) => {
    const {
        GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET,
        GOOGLE_ANALYTICS_KEY,
        GOOGLE_FIREBASE_WEB_CLIENT_ID,
    } = getEnvFunctions()

    if (!GOOGLE_ANALYTICS_KEY || !GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET) return

    const api_secret = GOOGLE_ANALYTICS_MEASURE_PROTOCOL_API_SECRET
    await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${GOOGLE_ANALYTICS_KEY}&api_secret=${api_secret}`,
        {
            method: 'POST',
            payload: JSON.stringify({
                client_id: GOOGLE_FIREBASE_WEB_CLIENT_ID,
                user_id: userId,
                events: [{ name: name, params: params }],
            }),
        },
        function (error, meta, body) {
            if (error) {
                functions.logger.error(error)
            }
            functions.logger.log(meta.status)
        }
    )
}

module.exports = { purchaseEvent, logEvent }
