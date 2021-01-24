const { createReadStream, createWriteStream, promises } = require('fs')
const { mkdir, readFile, stat, writeFile } = promises
const { View: GraphView, parse: parseGraph } = require('vega')
const { version } = require('../package.json')

const day = 24 * 60 * 60 * 1000
const root = 'public'
const units = ['abs', 'rel']
const types = ['cases', 'deaths']

function ensureDirectory (name) {
  const dir = (name && `${root}/${name}`) || root
  console.log(`ensuring ${dir}`)
  return mkdir(`${dir}`, { recursive: true })
}

async function readText (name, complete) {
  console.log(`reading from ${name}`)
  const file = complete ? name : `${root}/${name}`
  const content = await readFile(file, 'utf8')
  // console.log(`read ${content.length} bytes`)
  return content
}

function writeData (name, data) {
  // console.log(`writing ${data.length} bytes to ${name}`)
  return writeFile(`${root}/${name}`, data)
}

function statFile (name) {
  console.log(`inspecting ${name}`)
  return stat(`${root}/${name}`)
}

async function downloadText (url) {
  const fetch = require('node-fetch')
  console.log(`downloading from ${url}`)
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
  return resp.text()
}

async function getAllData () {
  const name = 'data.json'
  let data, updated
  try {
    const { mtime } = await statFile(name)
    const modified = new Date(mtime).getTime()
    if (new Date() > new Date(modified + 2 * day)) throw new Error()
    data = await readText(name)
  } catch {
    data = await downloadText('https://opendata.ecdc.europa.eu/covid19/casedistribution/json')
    await ensureDirectory()
    await writeData(name, data)
    updated = true
  }
  data = JSON.parse(data).records
  return { data, updated }
}

function prepareData (allData) {
  console.log(`processing ${allData.length} entries`)
  const weeks = extractWeeks()
  const data = extractStatistics()
  const max = computeMax()
  const countries = Object
    .keys(data)
    .reduce((sum, continent) => (sum += Object.keys(data[continent]).length), 0)
  console.log(`prepared ${countries} countries with ${weeks.length} weeks`)
  return { weeks, data, max }

  // {
  //   Europe: {
  //     Czechia: {
  //       abs: { cases: [...], deaths: [...] },
  //       rel: { cases: [...], deaths: [...] }
  //     },
  //     ...
  //   },
  //   ...
  // }
  function extractStatistics () {
    return allData
      .filter(({ continentExp }) => continentExp !== 'Other')
      .sort(({ year_week: left }, { year_week: right }) =>
        left < right ? -1 : left > right ? 1 : 0)
      .reduce((prepData, entry) => {
        const {
          countriesAndTerritories: country, continentExp, cases_weekly,
          deaths_weekly, popData2019
        } = entry
        const continentData = prepData[continentExp] || (prepData[continentExp] = {})
        const countryData = continentData[country] || (continentData[country] =
          { abs: { cases: [], deaths: [] }, rel: { cases: [], deaths: [] } })
        const { abs, rel } = countryData
        const people = popData2019 || 1
        abs.cases.push(cases_weekly)
        abs.deaths.push(deaths_weekly)
        rel.cases.push(makeRelative(cases_weekly))
        rel.deaths.push(makeRelative(deaths_weekly))
        return prepData

        function makeRelative (value) { return (value * 1000 / people).toFixed(3) }
      }, {})
  }

  // ['2020-01', ...]
  function extractWeeks () {
    return allData
      .filter(({ countriesAndTerritories: country }) => country === 'Czechia')
      .map(({ year_week }) => year_week)
      .sort()
  }

  // {
  //   Europe: {
  //     Czechia: {
  //       abs: { cases: [max, last], deaths: [max, last] },
  //       rel: { cases: [max, last], deaths: [max, last] }
  //     },
  //     ...
  //   },
  //   ...
  // }
  function computeMax () {
    const maxData = {}
    const continents = Object.keys(data)
    for (const continent of continents) {
      const continentMax = (maxData[continent] = {})
      const continentData = data[continent]
      const countries = Object.keys(continentData)
      for (const country of countries) {
        const countryMax = (continentMax[country] = {})
        const countryData = continentData[country]
        for (const unit of units) {
          const unitMax = (countryMax[unit] = {})
          const unitData = countryData[unit]
          for (const type of types) {
            const typeData = unitData[type]
            unitMax[type] = [
              Math.max.apply(null, typeData) || 0,
              typeData[typeData.length - 1]
            ]
          }
        }
      }
    }
    return maxData
  }
}

function prepareGraph (data, country, weeks, type, unit) {
  // console.log(`preparing graph of ${unit} ${type} for ${country}`)
  return {
    $schema: 'https://vega.github.io/schema/vega/v3.0.json',
    width: 100,
    height: 100,
    data: {
      name: 'table',
      values: data[country][unit][type].map((value, index) =>
        ({ week: weeks[index], value }))
    },
    scales: [
      {
        name: 'week',
        domain: { data: 'table', field: 'week' },
        range: 'width',
        type: 'band'
      },
      {
        name: 'value',
        domain: { data: 'table', field: 'value' },
        range: 'height'
      }
    ],
    marks: [
      {
        type: 'line',
        from: { data: 'table' },
        encode: {
          enter: {
            x: { scale: 'week', field: 'week' },
            y: { scale: 'value', field: 'value' }
          }
        }
      }
    ]
  }
}

async function renderGraph (graph) {
  const view = new GraphView(parseGraph(graph))
  const canvas = await view
    .renderer('none')
    .initialize()
    .toCanvas()
  return canvas.toBuffer()
}

async function updateImages ({ weeks, data }) {
  const continents = Object.keys(data)
  for (const unit of units) {
    for (const type of types) {
      for (const continent of continents) {
        await ensureDirectory(`images/${unit}/${type}/${continent}`)
        const continentData = data[continent]
        const countries = Object.keys(continentData)
        await Promise.all(countries.map(async country => {
          const graph = prepareGraph(continentData, country, weeks, type, unit)
          const image = await renderGraph(graph)
          await writeData(`images/${unit}/${type}/${continent}/${country}.png`, image)
        }))
      }
    }
  }
}

async function updateIndex ({ weeks, max }) {
  let content = await readText('internal/template.html', true)
  content = content.replace(/max = \{[^}]*\}/, `max = ${JSON.stringify(max)}`)
  content = content.replace(/lastWeek = '[^']*'/, `lastWeek = '${weeks[weeks.length - 1]}'`)
  content = content.replace(/Version 1.0.0/, `Version ${version}`)
  await writeData('index.html', content)
  await compressIndex()
}

function copyFile (name) {
  const reader = createReadStream(`internal/${name}`)
  const writer = createWriteStream(`public/${name}`)
  return new Promise((resolve, reject) =>
    reader
      .on('error', reject)
      .pipe(writer)
      .on('error', reject)
      .on('finish', resolve))
}

function compressFile (name, ext, compressor) {
  const reader = createReadStream(name)
  const writer = createWriteStream(`${name}.${ext}`)
  return new Promise((resolve, reject) =>
    reader
      .on('error', reject)
      .pipe(compressor)
      .on('error', reject)
      .pipe(writer)
      .on('error', reject)
      .on('finish', resolve))
}

function compressBrotli (name) {
  const { constants, createBrotliCompress } = require('zlib')
  const {
    BROTLI_PARAM_MODE, BROTLI_MODE_TEXT, BROTLI_PARAM_QUALITY, BROTLI_MAX_QUALITY
  } = constants
  return compressFile(name, 'br', createBrotliCompress({
    params: {
      [BROTLI_PARAM_MODE]: BROTLI_MODE_TEXT,
      [BROTLI_PARAM_QUALITY]: BROTLI_MAX_QUALITY
    }
  }))
}

function compressGzip (name) {
  const { createGzip } = require('zlib')
  return compressFile(name, 'gz', createGzip({ level: 9 }))
}

function compressIndex () {
  const name = 'public/index.html'
  console.log(`compressing ${name}`)
  return Promise.all([compressBrotli(name), compressGzip(name)])
}

async function updateSite (force) {
  try {
    const { data: allData, updated } = await getAllData()
    if (updated || force) {
      const prepData = prepareData(allData)
      await Promise.all([
        updateImages(prepData), updateIndex(prepData),
        copyFile('app.manifest'), copyFile('logo192.png'),
        copyFile('logo512.png'), copyFile('example.png')
      ])
    }
  } catch (err) {
    console.error(err)
  }
}

const generated = updateSite(true)

module.exports = { updateSite, generated }
