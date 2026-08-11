const express = require('express');

const app = express();
let visitCount = 0;

app.use(express.json());

app.get('/', (req, res) => {
  visitCount += 1;

  res.send(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Hello world</title>
      </head>
      <body>
        <main>
          <h1>Hello world!</h1>
          <p>You are visitor number ${visitCount}.</p>
        </main>
      </body>
    </html>
  `);
});

app.get('/hello/:name', (req, res) => {
  res.send(`<h1>Hello, ${req.params.name}!</h1>`);
});

app.post('/shout', (req, res) => {
  res.json({ message: req.body.message.toUpperCase() });
});

app.use((req, res) => {
  res.json({ error: `Cannot ${req.method} ${req.path}` });
});

module.exports = app;
