const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// In-memory Database for Boards (Phase 3 Placeholder)
const boardsDB = [];

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allowing all origins for development ease
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function setupRedisAdapter() {
  const pubClient = createClient({ url: REDIS_URL });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => console.error('Redis Pub Client Error', err.message));
  subClient.on('error', (err) => console.error('Redis Sub Client Error', err.message));

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Redis adapter initialized successfully');
  } catch (err) {
    console.warn('Could not connect to Redis. Running without Redis adapter (in-memory mode only).', err.message);
  }
}

setupRedisAdapter();

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join-room', (roomId, userDetails) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userDetails = userDetails; // { name, color }
    console.log(`User ${socket.id} (${userDetails?.name}) joined room: ${roomId}`);
    
    // Notify others in room
    socket.to(roomId).emit('user-joined', { userId: socket.id, ...userDetails });
  });

  socket.on('draw-event', ({ roomId, eventData }) => {
    socket.to(roomId).emit('draw-event', eventData);
  });
  
  socket.on('canvas-state', ({ roomId, state }) => {
    // Allows sending full canvas state to newly joined users if needed, 
    // though usually a host peer handles this. For now we broadcast state.
    socket.to(roomId).emit('canvas-state', state);
  });

  socket.on('cursor-move', ({ roomId, cursorData }) => {
    socket.to(roomId).emit('cursor-move', { userId: socket.id, ...cursorData });
  });

  // WebRTC Signaling
  socket.on('webrtc-signal', ({ targetId, signalData }) => {
    // Forward the signal to the specific target peer
    io.to(targetId).emit('webrtc-signal', { 
      senderId: socket.id, 
      signalData 
    });
  });

  socket.on('clear-board', (roomId) => {
    socket.to(roomId).emit('clear-board');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-left', socket.id);
    }
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// Dashboard APIs
app.post('/api/boards', (req, res) => {
  const { roomId, name, canvasState, thumbnail } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });

  // Update or insert
  const existingIndex = boardsDB.findIndex(b => b.roomId === roomId);
  const board = {
    roomId,
    name: name || roomId,
    canvasState,
    thumbnail,
    updatedAt: new Date().toISOString()
  };

  if (existingIndex > -1) {
    boardsDB[existingIndex] = board;
  } else {
    boardsDB.push(board);
  }

  res.status(200).json({ success: true, board });
});

app.get('/api/boards', (req, res) => {
  // Return all boards, sorted by recently updated
  const sorted = [...boardsDB].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  // Omit canvasState to save bandwidth on dashboard
  const previews = sorted.map(b => ({
    roomId: b.roomId,
    name: b.name,
    thumbnail: b.thumbnail,
    updatedAt: b.updatedAt
  }));
  res.status(200).json(previews);
});

app.get('/api/boards/:id', (req, res) => {
  const board = boardsDB.find(b => b.roomId === req.params.id);
  if (!board) return res.status(404).json({ error: 'Not found' });
  res.status(200).json(board);
});

app.delete('/api/boards/:id', (req, res) => {
  const index = boardsDB.findIndex(b => b.roomId === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  boardsDB.splice(index, 1);
  res.status(200).json({ success: true });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
