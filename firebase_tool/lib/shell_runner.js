const exec = require('child_process').exec
const chalk = require('chalk/index')
const log = console.log

module.exports = {
    run: (cmd, callback, quietMode) => {
        const child = exec(cmd, function (error, stdout, stderr) {
            log('\n')
            const quietMessage = chalk.cyan(
                `Executed command ${chalk.bgCyan.black.bold(` ${cmd} `)} in ${chalk.bold('quiet')} mode`
            )

            if (!quietMode) {
                log(chalk.green(`Execute command ${chalk.bgGreen.black.bold(` ${cmd} `)}`))
            }

            if (stdout !== null) {
                log(!quietMode ? chalk.green(`${stdout}`) : quietMessage)
                return callback !== undefined && callback(stdout)
            }
            if (stderr !== null) {
                log(!quietMode ? chalk.red(`${stderr}`) : quietMessage)
                return callback !== undefined && callback(stderr)
            }
            if (error !== null) {
                log(!quietMode ? chalk.red(`${error}`) : quietMessage)
                return callback !== undefined && callback(error)
            }
        })
    },
}
