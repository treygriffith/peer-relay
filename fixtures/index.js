var fs = require('fs')

exports.key = fs.readFileSync('fixtures/private.key')
exports.cert = fs.readFileSync('fixtures/primary.crt')
