import fs from 'node:fs'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { load, type CheerioAPI } from 'cheerio'
import { CLIENT_BROWSER_IMPORT, CLIENT_OUTFILE } from './constants.js'
import { buildClient, type Props } from './client/build.js'

function appendClientScriptTag($: CheerioAPI) {
  if ($($(`script[src="${CLIENT_BROWSER_IMPORT}"]`)).length < 1) {
    $('head').append(`<script type="module" src="${CLIENT_BROWSER_IMPORT}"></script>`)
  }
}

async function main() {
  const config = {
    template: './index.html',
    base: `/`,
    port: 6969,
  }

  const props: Props = {
    __HMR_HEADER__: 'x-hmr',
    __BASE__: config.base,
    __HMR_BASE__: config.base,
    __HMR_PORT__: config.port ?? 24678,
    __HMR_TIMEOUT__: 30_000,
    __SERVER_HOST__: '',
    __HMR_HOSTNAME__: null,
    __HMR_PROTOCOL__: null,
    __HMR_DIRECT_TARGET__: '',
    __HMR_ENABLE_OVERLAY__: false,
  }

  /**
   * TODO: build the client as needed. i.e. whenever the config changes.
   */
  await buildClient(props)

  const html = fs.readFileSync(config.template, 'utf-8')

  const $ = load(html)

  appendClientScriptTag($)

  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws) => {
    ws.on('error', console.error)
  })

  const server = http.createServer()

  setInterval(() => {
    wss.clients.forEach((client) => {
      client.send(JSON.stringify('PING'))
    })
  }, 1000)

  server.on('upgrade', (req, socket, head) => {
    if (
      req.headers['sec-websocket-protocol'] === props.__HMR_HEADER__ &&
      req.url === props.__HMR_BASE__
    ) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
        wss.clients.forEach((client) => {
          client.send(JSON.stringify('CONNECTED'))
        })
      })
    }
  })

  server.on('request', async (req, res) => {
    if (req.url === CLIENT_BROWSER_IMPORT) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' })
      res.end(fs.readFileSync(CLIENT_OUTFILE, 'utf-8'))
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end($.html())
    }
  })

  server.listen(config.port, () => {
    console.log(`Listening at http://localhost:${config.port}`)
  })
}

main()
