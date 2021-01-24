const cluster = require('cluster')
const sirv = require('sirv-cli')
const getPort = require('get-port')
const updateSite = require('./internal/generator')

const { LE_URL, LE_RESP } = process.env
const day = 24 * 60 * 60

function finishRequest (res, code, type, data) {
  res.writeHead(code, type && { 'Content-Type': type })
  res.end(data)
}

function failRequest (res, code, message) {
  res.writeHead(code, { 'Content-Type': 'text/plain' })
  res.end(message)
}

function negotiate (req, res) {
  const { url } = req
  if (url === LE_URL) finishRequest(res, 200, 'text/html', LE_RESP)
  else failRequest(res, 404, 'Not Found')
}

async function startNegotiator () {
  const { HOST, PORT } = process.env
  const host = HOST || '0.0.0.0'
  const port = await getPort({ host, port: (PORT && +PORT) || 5000 })
  require('http')
    .createServer(negotiate)
    .listen(port, host, err => {
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
    single: true,
    brotli: true,
    zlib: true,
    quiet: true,
    clear: true
  })
}

if (LE_URL && LE_RESP) {
  startNegotiator()
} else if (cluster.isMaster) {
  console.log(`running master ${process.pid}`)
  updateSite(true).then(err => {
    if (!err) {
      setInterval(() => updateSite(), 3 * day * 1000)
      const { WEB_CONCURRENCY } = process.env
      const forks = (WEB_CONCURRENCY && +WEB_CONCURRENCY) || 2
      for (let i = 0; i < forks; ++i) cluster.fork()
      cluster.on('exit', worker =>
        console.log(`worker ${worker.process.pid} ended`))
    } else {
      process.exitCode = 1
    }
  })
} else {
  console.log(`running worker ${process.pid}`)
  startServer()
}
