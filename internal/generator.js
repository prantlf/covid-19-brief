const { createReadStream, createWriteStream, promises } = require('fs')
const { mkdir, readFile, stat, writeFile } = promises
const { View: GraphView, parse: parseGraph } = require('vega')
const { version } = require('../package.json')

const day = 24 * 60 * 60 * 1000
const root = 'public'
const units = ['abs', 'rel']
const types = ['cases', 'deaths', 'hosp', 'icu']

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
  const allName = 'data.json'
  const hospName = 'hosp.json'
  let data, hosp, updated
  try {
    const { mtime } = await statFile(allName)
    const modified = new Date(mtime).getTime()
    if (new Date() > new Date(modified + 2 * day)) throw new Error()
    data = await readText(allName)
    hosp = await readText(hospName)
  } catch {
    data = await downloadText('https://opendata.ecdc.europa.eu/covid19/nationalcasedeath/json/')
    hosp = await downloadText('https://opendata.ecdc.europa.eu/covid19/hospitalicuadmissionrates/json/')
    await ensureDirectory()
    await writeData(allName, data)
    await writeData(hospName, hosp)
    updated = true
  }
  return { data: JSON.parse(data), hosp: JSON.parse(hosp), updated }
}

function prepareData (allData, hospData) {
  console.log(`processing ${allData.length} entries`)
  const countryMap = new Map()
  const aggregatedData = aggregateData()
  const weeks = extractWeeks()
  console.log(`Weeks: ${weeks}`)
  const data = extractStatistics()
  const max = computeMax()
  const countries = Object
    .keys(data)
    .reduce((sum, continent) => (sum += Object.keys(data[continent]).length), 0)
  console.log(`prepared ${countries} countries with ${weeks.length} weeks`)
  return { weeks, data, max }

  // convert to the original schema of the data from
  // either case distribution or national cases deaths
  function aggregateData () {
    if (allData[0].cases_weekly) return allData
    if (allData[0].countriesAndTerritories) return convertFromCaseDistribution()
    return convertFromNationalCasesDeaths()
  }

  // convert to the original schema of the data
  // { day, month, year, cases, deaths, ... } => { year_week, cases_weekly, deaths_weekly, ... }
  function convertFromCaseDistribution () {
    const aggregatedMap = new Map()
    for (const entry of allData) {
      const { countriesAndTerritories, continentExp, popData2019, cases, deaths } = entry
      const year_week = computeWeek(entry)
      const key = `${countriesAndTerritories}:${year_week}`
      let aggregatedEntry = aggregatedMap.get(key)
      if (!aggregatedEntry) {
        aggregatedEntry = {
          countriesAndTerritories,
          continentExp,
          popData2019,
          year_week,
          cases_weekly: 0,
          deaths_weekly: 0
        }
        aggregatedMap.set(key, aggregatedEntry)
      }
      if (!aggregatedEntry.popData2019) aggregatedEntry.popData2019 = popData2019
      aggregatedEntry.cases_weekly += cases
      aggregatedEntry.deaths_weekly += deaths
    }
    console.log(`aggregated ${aggregatedMap.size} entries`)
    return Array.from(aggregatedMap.values())

    function pad (value) {
      return value < 10 ? `0${value}` : value
    }

    function computeWeek ({ day, month, year }) {
      const date = new Date(year, month - 1, day)
      const start = new Date(date.getFullYear(), 0, 1)
      const dayCount = Math.floor((date - start) / (24 * 60 * 60 * 1000))
      const weekNum = Math.ceil((date.getDay() + dayCount + 1) / 7)
      return `${year}-${pad(weekNum)}`
    }
  }

  // convert to the original schema of the data
  // { country, continent, population, indicator, weekly_count, ... } =>
  //   { countriesAndTerritories, continentExp, popData2019, cases_weekly, deaths_weekly, ... }
  function convertFromNationalCasesDeaths () {
    const aggregatedMap = new Map()
    for (const { country, continent, population, indicator, weekly_count, year_week } of allData) {
      const key = `${country}:${year_week}`
      let aggregatedEntry = aggregatedMap.get(key)
      if (!aggregatedEntry) {
        aggregatedEntry = {
          countriesAndTerritories: country,
          continentExp: continent,
          popData2019: population,
          year_week
        }
        aggregatedMap.set(key, aggregatedEntry)
      }
      if (!aggregatedEntry.popData2019) aggregatedEntry.popData2019 = population
      if (indicator !== 'cases' && indicator !== 'deaths') {
        throw new Error(`unknown indicator "${indicator}"`)
      }
      aggregatedEntry[`${indicator}_weekly`] = weekly_count
    }
    console.log(`aggregated ${aggregatedMap.size} entries`)
    return Array.from(aggregatedMap.values())
  }

  // ['2020-01', ...]
  function extractWeeks () {
    return aggregatedData
      .filter(({ countriesAndTerritories: country }) => country === 'Czechia')
      .map(({ year_week }) => year_week)
      .sort()
  }

  // {
  //   Europe: {
  //     Czechia: {
  //       abs: { cases: [...], deaths: [...], hosp: [...], icu: [...] },
  //       rel: { cases: [...], deaths: [...], hosp: [...], icu: [...] }
  //     },
  //     ...
  //   },
  //   ...
  // }
  function extractStatistics () {
    const prepData = aggregatedData
      .filter(({ continentExp }) => continentExp !== 'Other')
      .sort(byWeekAscending)
      .reduce((prepData, {
        countriesAndTerritories: country, continentExp: continent,
        cases_weekly: cases, deaths_weekly: deaths, popData2019
      }) => {
        const continentData = prepData[continent] || (prepData[continent] = {})
        const people = popData2019 || 1
        const countryData = continentData[country] || (continentData[country] =
          {
            abs: { cases: [], deaths: [] },
            rel: { cases: [], deaths: [] },
            people
          })
        if (!countryMap.has(country)) countryMap.set(country, countryData)
        const { abs, rel } = countryData
        abs.cases.push(cases)
        abs.deaths.push(deaths)
        rel.cases.push(makeRelative(cases, people))
        rel.deaths.push(makeRelative(deaths, people))
        return prepData
      }, {})

    const types = {
      'Daily hospital occupancy': 'hosp',
      'Daily ICU occupancy': 'icu'
    }
    const skippedWeeks = new Set()
    hospData
      .filter(({ indicator }) => indicator in types)
      .sort(byWeekAscending)
      .forEach(({ country, indicator, year_week: week, value }) => {
        const countryData = countryMap.get(country)
        if (!countryData) {
          console.log(`Known countries: ${Array.from(countryMap.keys())}`)
          throw new Error(`Unknown country ${country}`)
        }
        const index = weeks.indexOf(week.replace('W', ''))
        if (index < 0) return skippedWeeks.add(week)
        const { abs, rel, people } = countryData
        const type = types[indicator]
        ensureValues(abs, type)[index] = value
        ensureValues(rel, type)[index] = makeRelative(value, people)
      })
    if (skippedWeeks.size > 0) console.warn(`skipped unknown weeks ${Array.from(skippedWeeks)}`)

    return prepData

    function byWeekAscending ({ year_week: left }, { year_week: right }) {
      return left < right ? -1 : left > right ? 1 : 0
    }

    function makeRelative (value, people) {
      return (value * 1000 / people).toFixed(3)
    }

    function ensureValues (source, type) {
      let values = source[type]
      if (!values) {
        values = source[type] = new Array(source.cases.length)
        values.fill(0)
      }
      return values
    }
  }

  // {
  //   Europe: {
  //     Czechia: {
  //       abs: { cases: [max, last], deaths: [max, last],
  //              hosp: [max, last], icu: [max, last] },
  //       rel: { cases: [max, last], deaths: [max, last],
  //              hosp: [max, last], icu: [max, last] }
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
            if (typeData) {
              unitMax[type] = [
                Math.max.apply(null, typeData) || 0,
                typeData[typeData.length - 1] || 0
              ]
            }
          }
        }
      }
    }
    return maxData
  }
}

const colors = {
  cases: '#1f77b4', deaths: '#8c564b', hosp: '#ff7f0e', icu: '#d62728'
}

function prepareGraph (data, country, weeks, type, unit) {
  const values = data[country][unit][type]
  if (!values) return
  // console.log(`preparing graph of ${unit} ${type} for ${country}`)
  return {
    $schema: 'https://vega.github.io/schema/vega/v3.0.json',
    width: 100,
    height: 100,
    data: {
      name: 'table',
      values: values.map((value, index) =>
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
            y: { scale: 'value', field: 'value' },
            stroke: { value: colors[type] }
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
          if (!graph) return
          const image = await renderGraph(graph)
          const file = country.replace(/[ ,/]/g, '_').replace(/_+/g, '_')
          await writeData(`images/${unit}/${type}/${continent}/${file}.png`, image)
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
    const { data: allData, hosp: hospData, updated } = await getAllData()
    if (updated || force) {
      const prepData = prepareData(allData, hospData)
      await Promise.all([
        updateImages(prepData), updateIndex(prepData),
        copyFile('app.manifest'), copyFile('logo192.png'),
        copyFile('logo512.png'), copyFile('example.png')
      ])
    }
  } catch (err) {
    console.error(err)
    return err
  }
}

module.exports = updateSite
