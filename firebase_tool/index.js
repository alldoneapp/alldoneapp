const clear = require('clear')
const chalk = require('chalk/index')
const figlet = require('figlet')
const { Command } = require('commander')
const { fields } = require('./lib/fields')
const { schema } = require('./lib/schema')

const log = console.log
const program = new Command()

clear()
program.version('1.0.0').description('AllDone Firebase Tool')

log(chalk.yellow(figlet.textSync('AllDone Firebase Tool')))

program.addCommand(fields())
program.addCommand(schema())

if (!process.argv.slice(2).length) {
    program.outputHelp()
    process.exit()
}
program.parse(process.argv)
