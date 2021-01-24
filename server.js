const sirv = require('sirv-cli')
const getPort = require('get-port')
const { existsSync, readFileSync } = require('fs')
const { parse: parseQuery } = require('querystring')
const { updateSite, generated } = require('./internal/generator')

const negotiation = readFileSync('internal/negotiation.html')
const day = 24 * 60 * 60
let question, answer

function finishRequest (res, code, type, data) {
  res.writeHead(code, type && { 'Content-Type': type })
  res.end(data)
}

function failRequest (res, code, message) {
  res.writeHead(code, { 'Content-Type': 'text/plain' })
  res.end(message)
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    let body = Buffer.alloc(0)
    req
      .on('data', chunk => (body = Buffer.concat([body, chunk])))
      .on('end', () => resolve(body.toString()))
      .on('error', reject)
  })
}

async function negotiate (req, res) {
  const { method, url } = req
  switch (method) {
    case 'GET':
      if (url === '/') finishRequest(res, 200, 'text/html', negotiation)
      else if (url === question) finishRequest(res, 200, 'text/plain', answer)
      else failRequest(res, 404, 'Not Found')
      break
    case 'POST':
      ({ question, answer } = parseQuery(await readBody(req)))
      finishRequest(res, 204)
      break
    default:
      failRequest(res, 405, 'Method Not Allowed')
  }
}

async function startNegotiator () {
  const server = require('http').createServer(negotiate)

  const { HOST, PORT } = process.env
  const host = HOST || '0.0.0.0'
  const port = await getPort({ host, port: PORT && +PORT || 5000 })
  server.listen(port, host, err => {
    if (err) throw err
    console.log(`listening on ${host}:${port}`)
  })
}

function startServer () {
  sirv('public', {
    http2: true,
    key: 'server.key',
    cert: 'server.cert',
    maxAge: 2 * day,
    immutable: true,
    single: true,
    brotli: true,
    zlib: true,
    quiet: true
  })
}

if (existsSync('server.key')) {
  generated
    .then(() => {
      startServer()
      setInterval(() => updateSite(), 3 * day * 1000)
    })
    .catch(err => {
      console.log(err)
      process.exitCode = 1
    })
} else {
  startNegotiator()
}
