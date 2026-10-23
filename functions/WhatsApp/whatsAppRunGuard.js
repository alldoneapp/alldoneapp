const { WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')

const WHATSAPP_TIMEOUT_CODE = 'WHATSAPP_ASSISTANT_TIMEOUT'

function createWhatsAppRunGuard(deadlineAt = Date.now() + WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS) {
    const controller = new AbortController()
    const timeoutError = Object.assign(new Error('WhatsApp assistant exceeded its response time limit'), {
        code: WHATSAPP_TIMEOUT_CODE,
    })
    const timer = setTimeout(() => controller.abort(timeoutError), Math.max(0, deadlineAt - Date.now()))
    timer.unref?.()

    const guard = {
        signal: controller.signal,
        toolStarted: false,
        assertActive() {
            if (Date.now() >= deadlineAt && !controller.signal.aborted) controller.abort(timeoutError)
            if (controller.signal.aborted) throw timeoutError
        },
        markToolStarted() {
            guard.assertActive()
            guard.toolStarted = true
        },
        async run(operation) {
            let onAbort
            const aborted = new Promise((_, reject) => {
                onAbort = () => reject(timeoutError)
                controller.signal.addEventListener('abort', onAbort, { once: true })
            })
            try {
                return await Promise.race([
                    Promise.resolve().then(() => {
                        guard.assertActive()
                        return operation()
                    }),
                    aborted,
                ])
            } finally {
                controller.signal.removeEventListener('abort', onAbort)
                clearTimeout(timer)
            }
        },
    }
    return guard
}

function getWhatsAppTimeoutMessage(language, interrupted = false) {
    if (
        String(language || '')
            .toLowerCase()
            .startsWith('de')
    ) {
        return interrupted
            ? 'Die Bearbeitung deiner vorherigen Anfrage wurde unterbrochen. Bitte prüfe in Alldone, ob Aktionen bereits ausgeführt wurden, bevor du die Anfrage erneut sendest.'
            : 'Die Bearbeitung deiner Anfrage hat zu lange gedauert und wurde abgebrochen. Bitte versuche es erneut. Falls du eine Aktion beauftragt hast, prüfe vorher in Alldone, ob sie bereits ausgeführt wurde.'
    }
    if (
        String(language || '')
            .toLowerCase()
            .startsWith('es')
    ) {
        return 'La solicitud se interrumpió o tardó demasiado. Antes de enviarla de nuevo, comprueba en Alldone si las acciones solicitadas ya se realizaron.'
    }
    return interrupted
        ? 'Your previous request was interrupted. Before sending it again, please check Alldone to see whether any requested actions already completed.'
        : 'Your request took too long and was stopped. Please try again. If you requested an action, check Alldone first to see whether it already completed.'
}

module.exports = { createWhatsAppRunGuard, WHATSAPP_TIMEOUT_CODE, getWhatsAppTimeoutMessage }
