'use strict'

const admin = require('firebase-admin')
const firebaseConfig = require('../firebaseConfig')

async function main() {
    try {
        admin.app()
    } catch (_) {
        firebaseConfig.init(admin)
    }

    const correlationId = process.env.VM_JOB_CORRELATION_ID
    if (!correlationId) throw new Error('VM_JOB_CORRELATION_ID is required')

    const { runVmJobByCorrelationId } = require('./vmJobRunner')
    await runVmJobByCorrelationId(correlationId)
}

main().catch(error => {
    console.error('🖥️ CLOUD RUN VM JOB: fatal error', {
        message: error.message,
        stack: error.stack,
    })
    process.exitCode = 1
})
