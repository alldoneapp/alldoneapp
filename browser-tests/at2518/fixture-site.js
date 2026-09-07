'use strict'

// The site the AT-2518 integration test browses. Two hosts, served from one loopback listener and
// told apart by the Host header, because Chromium is launched with
// `--host-resolver-rules=MAP tickets.example 127.0.0.1, MAP tracker.example 127.0.0.1`.
//
// It has to be a NAME rather than 127.0.0.1: the allowlist refuses IP literals and private hosts by
// design, so a fixture reachable only as an address could not be allowlisted and the test would be
// testing a bypass instead of the product.
//
// The pages are shaped around the decisions the policy has to make:
//
//   /                 a GET search form  -> the `search_submit` carve-out (allowed)
//   /search?q=…       its result page
//   /event/42         a POST form with a "Jetzt buchen" submit -> booking (must pause)
//                     plus content that appears after a delay -> browser_wait
//   /redirect         302 to tracker.example -> the worker's redirect containment
//   tracker.example/* off-allowlist, must never render

const http = require('http')

const PAGES = {
    '/': `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kulturhaus Tickets</title></head>
<body>
  <h1>Kulturhaus Tickets</h1>
  <form action="/search" method="get" role="search">
    <input type="search" name="q" placeholder="Konzert suchen" />
    <button type="submit">Suchen</button>
  </form>
  <a href="/event/42">Konzert am 15. September</a>
  <a href="/redirect">Partnerangebot</a>
</body></html>`,

    '/event/42': `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Konzert am 15. September</title></head>
<body>
  <h1>Konzert am 15. September</h1>
  <p id="availability">Verfügbarkeit wird geladen …</p>
  <form action="/checkout" method="post">
    <input type="text" name="menge" value="2" />
    <button type="submit">Jetzt buchen</button>
  </form>
  <form action="/newsletter" method="post">
    <input type="email" name="email" placeholder="E-Mail" />
    <button type="submit">Newsletter abonnieren</button>
  </form>
  <script>
    setTimeout(function () {
      document.getElementById('availability').textContent = 'Noch 12 Tickets verfügbar'
      var late = document.createElement('p')
      late.id = 'late-content'
      late.textContent = 'Spät geladener Hinweis'
      document.body.appendChild(late)
    }, 600)
  </script>
</body></html>`,
}

function renderSearch(query) {
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Suche: ${query}</title></head>
<body><h1>Treffer für ${query}</h1><p id="results">3 Konzerte gefunden</p></body></html>`
}

function startFixtureSite() {
    const server = http.createServer((request, response) => {
        const host = String(request.headers.host || '').split(':')[0]
        const url = new URL(request.url, 'http://placeholder.invalid')

        if (host === 'tracker.example') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end('<!doctype html><html><body><h1>OFF ALLOWLIST</h1></body></html>')
            return
        }

        if (url.pathname === '/redirect') {
            response.writeHead(302, { Location: 'http://tracker.example/steal' })
            response.end()
            return
        }

        if (url.pathname === '/search') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end(renderSearch(url.searchParams.get('q') || ''))
            return
        }

        if (url.pathname === '/checkout') {
            // Reached only if a booking approval was granted and the click went through.
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end('<!doctype html><html><body><h1>Buchung bestätigt</h1></body></html>')
            return
        }

        const page = PAGES[url.pathname]
        if (!page) {
            response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
            response.end('<!doctype html><html><body><h1>Nicht gefunden</h1></body></html>')
            return
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(page)
    })

    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
    })
}

module.exports = { startFixtureSite }
