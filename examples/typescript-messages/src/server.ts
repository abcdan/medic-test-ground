import express from "express";

const app = express();

const messages = [
  { id: 1, author: "Mina", body: "The release is ready." },
  { id: 2, author: "Noah", body: "The demo starts at two." },
  { id: 3, author: "Priya", body: "I updated the notes." },
];

app.get("/messages", (request, response) => {
  const limit = Number(request.query.limit ?? messages.length);
  response.json(messages.slice(0, limit));
});

app.listen(3000, () => {
  console.log("messages API listening on http://localhost:3000");
});
