# Covid-19 Brief Trends

[![Build Status](https://travis-ci.org/prantlf/covid-19-brief.png)](https://travis-ci.org/prantlf/covid-19-brief)
[![Dependency Status](https://david-dm.org/prantlf/covid-19-brief.svg)](https://david-dm.org/prantlf/covid-19-brief)
[![devDependency Status](https://david-dm.org/prantlf/covid-19-brief/dev-status.svg)](https://david-dm.org/prantlf/covid-19-brief#info=devDependencies)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

Briefly compares trends of active cases and new deaths connected to Covid-19 per week and country. Offers a rough overview of the virus momentum. Uses data from [ECDC]. See the current state [on-line].

![Example](./internal/example.png)

## Development

Make sure that you have [Node.js] >= 12 installed. Clone the repository, install the dependencies and start the server. You can use `npm` or `yarn` instead of `pnpm`.

    git clone https://github.com/prantlf/covid-19-brief.git
    cd covid-19-brief
    pnpm i
    node generate

This will generate the home page and graph images. You can open the HTML page `public/index.html` in a web browser.

    PORT=80 npm start

This will update the generated web site, start a web server on the specified port and wait for updates. You can open the HTML page `public/index.html` in a web browser.

## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding style. Lint your code using `npm test`.

## License

Copyright (c) 2018-2021 Ferdinand Prantl

Licensed under the MIT license.

Icon made by [srip from www.flaticon.com].

[on-line]: https://prantlf.github.io/covid-19-brief
[ECDC]: https://opendata.ecdc.europa.eu/
[Node.js]: https://nodejs.org/
[srip from www.flaticon.com]: https://www.flaticon.com/free-icon/coronavirus_2833315
