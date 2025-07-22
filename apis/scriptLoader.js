class ScriptLoader {
    loadedScripts = {}
    loadScript(src) {
        const self = this
        if (self.loadedScripts[src]) {
            return self.loadedScripts[src].status === 'loaded' ? Promise.resolve() : self.loadedScripts[src].promise
        }
        let success, fail
        const promise = new Promise((resolve, reject) => {
            success = resolve
            fail = reject
        })
        const script = document.createElement('script')
        script.src = src
        script.async = true
        script.defer = true
        self.loadedScripts[src] = { status: 'loading', promise }
        document.body.appendChild(script)
        script.addEventListener('load', () => {
            self.loadedScripts[src].status = 'loaded'
            delete self.loadedScripts[src].promise
            success()
        })
        script.addEventListener('error', err => {
            delete self.loadedScripts[src]
            fail(err)
        })
        return promise
    }
}

export default new ScriptLoader()
