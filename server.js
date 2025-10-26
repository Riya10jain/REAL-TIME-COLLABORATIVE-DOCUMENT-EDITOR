require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const Document = require('./models/Document');

const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/collab-docs';

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Get or create document
app.get('/documents/:id', async (req, res) => {
  const id = req.params.id;
  let doc = await Document.findById(id);
  if (!doc) return res.status(404).json({error:'Document not found'});
  res.json(doc);
});

app.post('/documents', async (req, res) => {
  const { title, content } = req.body;
  const doc = new Document({ title: title || 'Untitled', content: content || JSON.stringify({ops:[{insert:'\n'}]}) });
  await doc.save();
  res.json(doc);
});

// Socket.io for realtime Quill delta sync
io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join-document', async (docId) => {
    socket.join(docId);
    console.log(socket.id, 'joined', docId);
    let doc = await Document.findById(docId);
    if (!doc) {
      doc = new Document({ _id: docId, title: 'Untitled', content: JSON.stringify({ops:[{insert:'\n'}]}) });
      try { await doc.save(); } catch(e) { /* ignore */ }
    }
    // send saved delta to joining client
    socket.emit('load-document', JSON.parse(doc.content));
  });

  // receive delta from a client and broadcast to others
  socket.on('send-changes', ({ docId, delta }) => {
    socket.to(docId).emit('receive-changes', delta);
  });

  // save document content (full delta) to DB
  socket.on('save-document', async ({ docId, delta }) => {
    try {
      await Document.findByIdAndUpdate(docId, { content: JSON.stringify(delta) }, { upsert: true, new: true });
      socket.emit('saved');
    } catch (err) {
      console.error('save error', err);
    }
  });

  socket.on('disconnect', () => {
    // console.log('disconnected', socket.id);
  });
});

server.listen(PORT, ()=> console.log('Server listening on', PORT));
