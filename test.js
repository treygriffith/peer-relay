var assert = require('assert')
var Client = require('./lib/client')
var wrtc = require('electron-webrtc')()
var crypto = require('crypto')
var http = require('http')
var https = require('https')
var fixtures = require('./fixtures')

wrtc.on('error', function (err) { console.error(err, err.stack) })

describe('End to End', function () {
  var clients = []

  function startClient (opts) {
    var c = new Client(opts)
    clients.push(c)
    return c
  }

  this.afterEach(function (done) {
    function destroy () {
      if (clients.length === 0) {
        done()
      } else {
        clients.pop().destroy(destroy)
      }
    }
    destroy()
  })

  it('two peers connect', function (done) {
    var c1 = startClient({ port: 8001, bootstrap: [] })
    var c2 = startClient({ port: 8002, bootstrap: ['ws://localhost:8001'] })
    var count = 0

    c1.on('peer', function (id) {
      assert.ok(id.equals(c2.id))
      assert.ok(count <= 2)
      count++
      if (count === 2) done()
    })

    c2.on('peer', function (id) {
      assert.ok(id.equals(c1.id))
      assert.ok(count <= 2)
      count++
      if (count === 2) done()
    })
  })

  it('direct message', function (done) {
    var c1 = startClient({ port: 8001, bootstrap: [] })
    var c2 = startClient({ port: 8002, bootstrap: ['ws://localhost:8001'] })
    var count = 0

    c1.on('peer', function (id) {
      assert.ok(id.equals(c2.id))
      c1.send(id, 'TEST1')
    })

    c2.on('peer', function (id) {
      assert.ok(id.equals(c1.id))
      c2.send(id, 'TEST2')
    })

    c1.on('message', function (msg, id) {
      assert.ok(id.equals(c2.id))
      assert.equal(msg, 'TEST2')
      assert.ok(count <= 2)
      count++
      if (count === 2) done()
    })

    c2.on('message', function (msg, id) {
      assert.ok(id.equals(c1.id))
      assert.equal(msg, 'TEST1')
      assert.ok(count <= 2)
      count++
      if (count === 2) done()
    })
  })

  it('send message before connect', function (done) {
    var c1 = startClient({ port: 8001, bootstrap: [] })
    var c2 = startClient({ port: 8002, bootstrap: ['ws://localhost:8001'] })
    var count = 0

    c1.on('message', function (msg, id) {
      assert.ok(id.equals(c2.id))
      assert.equal(msg, 'TEST2')
      assert.ok(count <= 2)
      count++
      if (count === 2) done()
    })

    c2.on('message', function (msg, id) {
      assert.ok(id.equals(c1.id))
      assert.equal(msg, 'TEST1')
      assert.ok(count <= 2)
      count++
      if (count === 2) done()
    })

    c2.send(c1.id, 'TEST2')
    c1.send(c2.id, 'TEST1')
  })

  it('relay message', function (done) {
    // c1 <-> c2 <-> c3
    var c2 = startClient({ port: 8002, bootstrap: [] })
    var c1 = startClient({ port: 8001, bootstrap: ['ws://localhost:8002'] })
    var c3 = startClient({ port: 8003, bootstrap: ['ws://localhost:8002'] })

    c1.on('peer', function (id) {
      assert.ok(id.equals(c2.id))
      c1.send(c3.id, 'TEST')
    })

    c3.on('message', function (msg, id) {
      assert.ok(id.equals(c1.id))
      assert.equal(msg, 'TEST')
      done()
    })
  })

  it('clients automatically populate', function (done) {
    // c1 <-> c2 <-> c3
    var c2 = startClient({ port: 8002, bootstrap: [] })
    var c1 = startClient({ port: 8001, bootstrap: ['ws://localhost:8002'] })
    var c3 = startClient({ port: 8003, bootstrap: ['ws://localhost:8002'] })

    var c1PeerEvent = false
    var c3PeerEvent = false

    c1.on('peer', function (id) {
      if (id.equals(c2.id)) {
        // c1.connect(c3.id)
      } else if (id.equals(c3.id)) {
        c1PeerEvent = true
        c1.disconnect(c2.id)
        c1.send(c3.id, 'TEST')
      } else {
        assert.ok(false)
      }
    })

    c3.on('peer', function (id) {
      assert.ok(id.equals(c1.id) || id.equals(c2.id))
      if (id.equals(c1.id)) c3PeerEvent = true
    })

    c3.on('message', function (msg, id) {
      assert.ok(id.equals(c1.id))
      assert.equal(msg, 'TEST')
      assert.ok(c1PeerEvent)
      assert.ok(c3PeerEvent)
      done()
    })
  })

  it('deterministic id', function (done) {
    var id = crypto.randomBytes(20)
    var c1 = startClient({ id: id, port: 8001, bootstrap: [] })
    assert.ok(id.equals(c1.id))

    var c2 = startClient({ port: 8002, bootstrap: ['ws://localhost:8001'] })

    c2.on('peer', function (c2id) {
      assert.ok(id.equals(c2id))
      done()
    })
  })

  it('allows a custom hostname', function (done) {
    // set localtest to 127.0.0.1 in /etc/hosts
    var c1 = startClient({ port: 8001, host: 'localtest', bootstrap: [] })
    assert.equal(c1.wsConnector.url, 'ws://localtest:8001')

    var c2 = startClient({ port: 8002, bootstrap: ['ws://localtest:8001'] })

    c2.on('peer', function (c1id) {
      assert.ok(c1.id.equals(c1id))
      done()
    })
  })

  it('allows custom servers', function (done) {
    var server = http.createServer(function (req, res) {
      var body = http.STATUS_CODES[426]

      res.writeHead(426, {
        'Content-Length': body.length,
        'Content-Type': 'text/plain'
      })
      res.end(body)
    })
    server.allowHalfOpen = false
    server.listen(8001, function () {
      var c1 = startClient({ server: server })

      var c2 = startClient({ port: 8002, bootstrap: ['ws://localhost:8001'] })

      c2.on('peer', function (c1id) {
        assert.ok(c1.id.equals(c1id))
        done()
      })
    })
  })

  it('allows wss:// urls', function (done) {
    var server = https.createServer({
      key: fixtures.key,
      cert: fixtures.cert
    }, function (req, res) {
      var body = http.STATUS_CODES[426]

      res.writeHead(426, {
        'Content-Length': body.length,
        'Content-Type': 'text/plain'
      })
      res.end(body)
    })
    server.allowHalfOpen = false
    server.listen(8443, function () {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

      var c1 = startClient({ server: server })

      var c2 = startClient({ port: 8002, bootstrap: ['wss://localhost:8443'] })

      c2.on('peer', function (c1id) {
        assert.ok(c1.id.equals(c1id))
        done()
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      })
    })
  })

  // it('webrtc connect and send message', function (done) {
  //   // c1 <-> c2 <-> c3
  //   var c2 = startClient({ port: 8002, bootstrap: [] })
  //   var c1 = startClient({ wrtc: wrtc, bootstrap: ['ws://localhost:8002'] })
  //   var c3 = startClient({ wrtc: wrtc, bootstrap: ['ws://localhost:8002'] })

  //   c1.on('peer', function (id) {
  //     assert.ok(id.equals(c2.id) || id.equals(c3.id))
  //     if (id.equals(c3.id)) c1.send(c3.id, 'TEST')
  //   })

  //   c3.on('message', function (msg, id) {
  //     assert.ok(id.equals(c1.id))
  //     assert.equal(msg, 'TEST')
  //     done()
  //   })
  // })

  // it('relay chain', function (done) {
  //   var peers = []
  //   for (var i = 0; i < 10; i++) {
  //     peers.push(startClient({
  //       port: 8000 + i,
  //       bootstrap: i === 0 ? [] : ['ws://localhost:' + (8000 + i - 1)]
  //     }))
  //   }

  //   var first = peers[0]
  //   var last = peers[peers.length - 1]

  //   last.on('message', function (msg, id) {
  //     assert.ok(id.equals(first.id))
  //     assert.equal('TEST', msg)
  //     done()
  //   })

  //   onBootstrap(peers, function () {
  //     first.send(last.id, 'TEST')
  //   })
  // })
})

// function onBootstrap (peers, cb) {
//   for (var p of peers) {
//     p.on('peer', function () {
//       if (isBootstrapped()) cb()
//     })
//   }
//
//   function isBootstrapped () {
//     for (var p of peers) {
//       if (p.peers.count() === 0) return false
//     }
//     return true
//   }
// }
