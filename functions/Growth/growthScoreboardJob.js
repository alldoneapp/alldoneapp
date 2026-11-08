'use strict'

// The daily scheduled job: compute the day's metrics, then rewrite the scoreboard artifact.
// Publishing is best effort: the metrics document is written first and is what counts.

const admin = require('firebase-admin')
const functions = require('firebase-functions')
const { runGrowthScoreboard, readScoreboardHistory, STATE_DOC } = require('./growthScoreboard')
const { publishScoreboardArtifact, renderScoreboardHtml } = require('./growthScoreboardArtifact')
const { describeCostRates } = require('./growthCostModel')
const { SCOREBOARD_HISTORY_DAYS } = require('./growthConfig')

function createStripeClient() {
    const { getEnvFunctions } = require('../envFunctionsHelper')
    const { STRIPE_SECRET_KEY } = getEnvFunctions()
    return STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null
}

async function runGrowthScoreboardJob(options = {}, deps = {}) {
    const db = deps.db || admin.firestore()
    const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')
    const environment = deps.environment || (inProductionEnvironment() ? 'production' : 'staging')
    const stripe = deps.stripe !== undefined ? deps.stripe : createStripeClient()

    const { metrics, state } = await runGrowthScoreboard(options, { ...deps, db, stripe, environment })

    let artifactId = state.scoreboardArtifactId || null
    try {
        const history = await readScoreboardHistory(db, metrics.day, SCOREBOARD_HISTORY_DAYS)
        const html = renderScoreboardHtml({
            latest: metrics,
            history,
            latestMargin: state.latestMargin || null,
            latestMarginDay: state.latestMarginDay || null,
            rates: describeCostRates(),
            generatedAt: metrics.generatedAt,
        })
        artifactId = await publishScoreboardArtifact({
            html,
            day: metrics.day,
            artifactId,
            environment,
            commit: deps.commitArtifactVersion,
        })
        if (artifactId && artifactId !== state.scoreboardArtifactId) {
            await db.doc(STATE_DOC).set({ scoreboardArtifactId: artifactId }, { merge: true })
        }
    } catch (error) {
        functions.logger.error('[growthScoreboard] The scoreboard artifact could not be published', {
            day: metrics.day,
            error: error.message,
        })
    }

    functions.logger.info('[growthScoreboard] Day written', {
        day: metrics.day,
        signups: metrics.signups.count,
        payingUsers: metrics.premium.payingUsers,
        netRevenueEur: metrics.revenue.netEur,
        trafficConnected: !!(metrics.traffic && metrics.traffic.connected),
        marginComputed: !!metrics.margin,
        artifactId,
        run: metrics.run,
    })
    return { metrics, artifactId }
}

module.exports = { runGrowthScoreboardJob }
