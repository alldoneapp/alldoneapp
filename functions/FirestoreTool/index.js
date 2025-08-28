const clear = require('clear')
const chalk = require('chalk')
const figlet = require('figlet')
const { Command } = require('commander')
const { users } = require('./UsersCmd')
const { backups } = require('./BackupsCmd')
const { dbscript } = require('./DBScriptCmd')

const log = console.log
const program = new Command()

clear()
program.version('1.0.0').description('AllDone Firestore Tool')

log(chalk.yellow(figlet.textSync('AllDone Firestore Tool')))

program.addCommand(users())
program.addCommand(backups())
program.addCommand(dbscript())

if (!process.argv.slice(2).length) {
    program.outputHelp()
    process.exit()
}
program.parse(process.argv)
