const exec = require('child_process').exec
const chalk = require('chalk')
const log = console.log

module.exports = {
    run: (cmd, callback) => {
        const child = exec(cmd, function (error, stdout, stderr) {
            log('\n')
            log(chalk.green(`Execute command ${chalk.bgGreen.black.bold(` ${cmd} `)}`))

            if (stdout !== null) {
                log(chalk.green(`${stdout}`))
                return callback !== undefined && callback(stdout)
            }
            if (stderr !== null) {
                log(chalk.red(`${stderr}`))
                return callback !== undefined && callback(stderr)
            }
            if (error !== null) {
                log(chalk.red(`${error}`))
                return callback !== undefined && callback(error)
            }
        })
    },
}
