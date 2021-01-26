const cluster = require('cluster')
const sirv = require('sirv-cli')
const updateSite = require('./internal/generator')

const day = 24 * 60 * 60

function startServer () {
  sirv('public', {
    maxAge: 2 * day,
    m: 2 * day, // workaround for a bug in sirv
    single: true,
    brotli: true,
    zlib: true,
    quiet: true,
    clear: true
  })
}

const { WEB_CONCURRENCY, NOCLUSTER } = process.env
if (NOCLUSTER) {
  console.log(`running single ${process.pid}`)
  updateSite(true).then(err => {
    if (!err) {
      startServer()
      setInterval(() => updateSite(), 3 * day * 1000)
    } else {
      process.exitCode = 1
    }
  })
} else if (cluster.isMaster) {
  console.log(`running master ${process.pid}`)
  updateSite(true).then(err => {
    if (!err) {
      setInterval(() => updateSite(), 3 * day * 1000)
      const forks = (WEB_CONCURRENCY && +WEB_CONCURRENCY) || 1
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
