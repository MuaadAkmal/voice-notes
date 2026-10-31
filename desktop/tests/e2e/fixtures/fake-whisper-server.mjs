// Stands in for whisper-server.exe in e2e: same identity page and OpenAI-style route, canned transcript.
import http from 'node:http';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]);
const parent = process.ppid;

http
  .createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/') {
        res.setHeader('content-type', 'text/html');
        res.end('<title>Whisper.cpp Server</title>');
      } else if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ text: ' hello from local\n', language: 'english' }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
  })
  .listen(port, '127.0.0.1');

// The test app quits with app.exit(), which skips will-quit: don't outlive it.
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    process.exit(0);
  }
}, 1000);
