import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import * as fabric from 'fabric';
import * as pdfjsLib from 'pdfjs-dist';
import {
  PenTool, Square, Circle, Minus,
  Type, Eraser, Download, Trash2, LogOut,
  Undo2, Redo2, MousePointer2, StickyNote, Image as ImageIcon,
  Home, Mic, MicOff, Users, Wifi, Hand, ZoomIn, ZoomOut, FileText
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.js',
  import.meta.url
).toString();

// Connect to backend server on port 5000 or relative if deployed
const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const COLORS = ['#f8fafc', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];

export default function Whiteboard({ roomData, onLeave }) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const socketRef = useRef(null);

  const [activeTool, setActiveTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [peers, setPeers] = useState({});
  const [isMicOn, setIsMicOn] = useState(false);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [latency, setLatency] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const localStreamRef = useRef(null);
  const rtcPeersRef = useRef({});
  const audioContextsRef = useRef({});

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Refs for closures
  const activeToolRef = useRef(activeTool);
  const colorRef = useRef(color);
  const strokeWidthRef = useRef(strokeWidth);
  const lastCursorEmitRef = useRef(0);

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);

  // To handle shape drawing state
  const isDrawingShape = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const shapeRef = useRef(null);

  // History for Undo/Redo
  const history = useRef([]);
  const redoStack = useRef([]);
  const isUpdating = useRef(false); // Flag to prevent socket loops during incoming updates

  // Pan & Zoom state
  const isDraggingCanvas = useRef(false);
  const lastPosX = useRef(0);
  const lastPosY = useRef(0);

  useEffect(() => {
    // Initialize Canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: true,
      width: window.innerWidth,
      height: window.innerHeight,
      selection: false,
      backgroundColor: 'transparent'
    });
    
    // Set 0,0 to the center of the window so users start together
    canvas.setViewportTransform([1, 0, 0, 1, window.innerWidth / 2, window.innerHeight / 2]);

    // In v6, initialize PencilBrush explicitly
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = colorRef.current;
    canvas.freeDrawingBrush.width = strokeWidthRef.current;
    fabricRef.current = canvas;

    // Initialize Socket and force websocket transport to avoid HTTP polling overhead
    socketRef.current = io(SOCKET_URL, { transports: ['websocket'] });
    const socket = socketRef.current;

    socket.emit('join-room', roomData.roomId, { name: roomData.userName, color: roomData.userColor });

    // Fetch previously saved board state
    fetch(`${SOCKET_URL}/api/boards/${roomData.roomId}`)
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(board => {
        if (board && board.canvasState) {
          canvas.loadFromJSON(board.canvasState).then(() => {
            canvas.requestRenderAll();
          }).catch(console.error);
        }
      })
      .catch(err => console.log("Starting fresh board."));

    // WebRTC connection helper
    const createPeerConnection = (targetId, socket) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      rtcPeersRef.current[targetId] = pc;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-signal', {
            targetId,
            signalData: { type: 'ice-candidate', candidate: event.candidate }
          });
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('webrtc-signal', {
            targetId,
            signalData: { type: 'offer', offer }
          });
        } catch (e) {
          console.error("Negotiation error", e);
        }
      };

      pc.ontrack = (event) => {
        let audio = document.getElementById(`audio-${targetId}`);
        if (!audio) {
          audio = document.createElement('audio');
          audio.id = `audio-${targetId}`;
          audio.autoplay = true;
          document.body.appendChild(audio);
        }
        audio.srcObject = event.streams[0];
        monitorAudio(event.streams[0], `audio-indicator-${targetId}`);
      };

      return pc;
    };

    // Socket Listeners
    socket.on('user-joined', (user) => {
      setPeers(prev => {
        const newPeers = { ...prev };
        // Remove any existing peer with the same name to prevent duplicates
        Object.keys(newPeers).forEach(id => {
          if (newPeers[id].name === user.name) {
            delete newPeers[id];
          }
        });
        newPeers[user.userId] = { x: -100, y: -100, name: user.name, color: user.color, latency: 0 };
        return newPeers;
      });
      // Don't manually create offer here anymore, creating connection and adding tracks 
      // will trigger onnegotiationneeded.
      createPeerConnection(user.userId, socket);
    });

    socket.on('room-users', (existingPeers) => {
      setPeers(prev => {
        const newPeers = { ...prev };
        Object.keys(existingPeers).forEach(userId => {
          const peer = existingPeers[userId];
          // Remove duplicate names
          const duplicateId = Object.keys(newPeers).find(id => newPeers[id].name === peer.name);
          if (duplicateId) delete newPeers[duplicateId];

          newPeers[userId] = { x: -100, y: -100, name: peer.name, color: peer.color, latency: peer.latency || 0 };
        });
        return newPeers;
      });
    });

    socket.on('peer-latency', ({ userId, latency: peerLatency }) => {
      setPeers(prev => {
        if (!prev[userId]) return prev;
        return { ...prev, [userId]: { ...prev[userId], latency: peerLatency } };
      });
    });

    // Ping mechanism for latency
    const pingInterval = setInterval(() => {
      const start = Date.now();
      socket.emit('ping', () => {
        const duration = Date.now() - start;
        setLatency(duration);
        socket.emit('update-latency', { roomId: roomData.roomId, latency: duration });
      });
    }, 3000);

    socket.on('webrtc-signal', async ({ senderId, signalData }) => {
      let pc = rtcPeersRef.current[senderId];
      if (!pc && signalData.type === 'offer') {
        pc = createPeerConnection(senderId, socket);
      }
      if (!pc) return;

      if (signalData.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-signal', {
          targetId: senderId,
          signalData: { type: 'answer', answer }
        });
      } else if (signalData.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.answer));
      } else if (signalData.type === 'ice-candidate') {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
        } catch (e) {
          console.error("Error adding ice candidate", e);
        }
      }
    });

    socket.on('draw-event', (eventData) => {
      isUpdating.current = true;
      if (eventData.type === 'object-added') {
        fabric.util.enlivenObjects([eventData.object]).then((enlivenedObjects) => {
          const obj = enlivenedObjects[0];
          canvas.add(obj);
          canvas.renderAll();
        }).catch(err => console.error("Enliven error", err));
      } else if (eventData.type === 'object-removed') {
        // Naive removal by ID (we need to tag objects with IDs)
        if (eventData.id) {
          const objToRemove = canvas.getObjects().find(o => o.id === eventData.id);
          if (objToRemove) canvas.remove(objToRemove);
        }
      } else if (eventData.type === 'clear') {
        canvas.clear();
      }
      setTimeout(() => isUpdating.current = false, 50);
    });

    socket.on('cursor-move', (data) => {
      setPeers(prev => ({
        ...prev,
        [data.userId]: { x: data.x, y: data.y, name: data.name, color: data.color }
      }));
    });

    socket.on('user-left', (userId) => {
      setPeers(prev => {
        const newPeers = { ...prev };
        delete newPeers[userId];
        return newPeers;
      });
      if (rtcPeersRef.current[userId]) {
        rtcPeersRef.current[userId].close();
        delete rtcPeersRef.current[userId];
      }
      const audio = document.getElementById(`audio-${userId}`);
      if (audio) audio.remove();
      stopMonitorAudio(`audio-indicator-${userId}`);
    });

    socket.on('clear-board', () => {
      isUpdating.current = true;
      canvas.clear();
      setTimeout(() => isUpdating.current = false, 50);
    });

    // Window Resize
    const handleResize = () => {
      canvas.setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);

    // Broadcast Freehand Path
    canvas.on('path:created', (e) => {
      if (isUpdating.current) return;
      const obj = e.path;
      obj.set({ id: Math.random().toString(36).substr(2, 9) }); // add custom id
      history.current.push(obj);
      redoStack.current = [];
      socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: obj.toJSON(['id']) } });
    });

    // Pan & Zoom
    canvas.on('mouse:wheel', function (opt) {
      if (opt.e.ctrlKey) {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        if (zoom > 20) zoom = 20;
        if (zoom < 0.01) zoom = 0.01;
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      } else {
        const vpt = canvas.viewportTransform;
        let newX = vpt[4] - opt.e.deltaX;
        let newY = vpt[5] - opt.e.deltaY;
        
        const LIMIT = 3000;
        if (newX > LIMIT) newX = LIMIT;
        if (newX < -LIMIT) newX = -LIMIT;
        if (newY > LIMIT) newY = LIMIT;
        if (newY < -LIMIT) newY = -LIMIT;

        vpt[4] = newX;
        vpt[5] = newY;
        canvas.setViewportTransform(vpt);
      }
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Helper to get reliable coordinates for panning (handles both mouse and touch)
    const getViewportCoords = (opt) => {
      if (opt.viewportPoint) {
        return { x: opt.viewportPoint.x, y: opt.viewportPoint.y };
      }
      if (opt.e.touches && opt.e.touches.length > 0) {
        return { x: opt.e.touches[0].clientX, y: opt.e.touches[0].clientY };
      }
      if (opt.e.changedTouches && opt.e.changedTouches.length > 0) {
        return { x: opt.e.changedTouches[0].clientX, y: opt.e.changedTouches[0].clientY };
      }
      return { x: opt.e.clientX || 0, y: opt.e.clientY || 0 };
    };

    // Handle Cursors and Dragging
    canvas.on('mouse:move', (e) => {
      if (isDraggingCanvas.current) {
        const coords = getViewportCoords(e);
        const vpt = canvas.viewportTransform;
        let newX = vpt[4] + coords.x - lastPosX.current;
        let newY = vpt[5] + coords.y - lastPosY.current;
        
        const LIMIT = 3000;
        if (newX > LIMIT) newX = LIMIT;
        if (newX < -LIMIT) newX = -LIMIT;
        if (newY > LIMIT) newY = LIMIT;
        if (newY < -LIMIT) newY = -LIMIT;

        vpt[4] = newX;
        vpt[5] = newY;
        canvas.requestRenderAll();
        lastPosX.current = coords.x;
        lastPosY.current = coords.y;
        return;
      }

      const pointer = e.scenePoint || { x: 0, y: 0 };
      const now = Date.now();
      // Throttle cursor emit to ~30fps to prevent network lag
      if (now - lastCursorEmitRef.current > 33) {
        socket.emit('cursor-move', {
          roomId: roomData.roomId,
          cursorData: { x: pointer.x, y: pointer.y, name: roomData.userName, color: roomData.userColor }
        });
        lastCursorEmitRef.current = now;
      }

      const tool = activeToolRef.current;

      // Drag to erase
      if (tool === 'eraser' && e.e.buttons === 1) {
        let target = e.target;
        if (!target) {
          const pt = new fabric.Point(pointer.x, pointer.y);
          const objects = canvas.getObjects();
          for (let i = objects.length - 1; i >= 0; i--) {
            if (objects[i].containsPoint(pt)) {
              target = objects[i];
              break;
            }
          }
        }
        if (target) {
          canvas.remove(target);
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-removed', id: target.id } });
        }
        return;
      }

      // Shape Drawing Logic
      if (!isDrawingShape.current || tool === 'pen' || tool === 'select' || tool === 'eraser') return;

      if (shapeRef.current) {
        if (tool === 'rect') {
          shapeRef.current.set({ width: Math.abs(pointer.x - startX.current), height: Math.abs(pointer.y - startY.current) });
        } else if (tool === 'circle') {
          const radius = Math.abs(pointer.x - startX.current) / 2;
          shapeRef.current.set({ radius });
        } else if (tool === 'line') {
          shapeRef.current.set({ x2: pointer.x, y2: pointer.y });
        }
        canvas.renderAll();
      }
    });

    canvas.on('mouse:down', (e) => {
      const tool = activeToolRef.current;
      if (e.e.altKey || e.e.button === 1 || tool === 'pan') {
        isDraggingCanvas.current = true;
        canvas.selection = false;
        const coords = getViewportCoords(e);
        lastPosX.current = coords.x;
        lastPosY.current = coords.y;
        return;
      }

      if (tool === 'pen' || tool === 'select') return;

      const pointer = e.scenePoint || { x: 0, y: 0 };
      startX.current = pointer.x;
      startY.current = pointer.y;

      if (tool === 'eraser') {
        let target = e.target;
        if (!target) {
          const pt = new fabric.Point(pointer.x, pointer.y);
          const objects = canvas.getObjects();
          for (let i = objects.length - 1; i >= 0; i--) {
            if (objects[i].containsPoint(pt)) {
              target = objects[i];
              break;
            }
          }
        }

        if (target) {
          canvas.remove(target);
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-removed', id: target.id } });
        }
        return;
      }

      if (tool === 'text') {
        const text = new fabric.IText('Text', {
          left: pointer.x, top: pointer.y, fill: colorRef.current, fontSize: 24, fontFamily: 'Inter', id: Math.random().toString(36).substr(2, 9)
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();

        text.on('editing:exited', () => {
          socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: text.toJSON(['id']) } });
          history.current.push(text);
        });
        return;
      }

      if (tool === 'sticky') {
        const stickyColor = colorRef.current === '#f8fafc' ? '#fde047' : colorRef.current;
        const sticky = new fabric.Textbox('Type here...', {
          left: pointer.x, top: pointer.y, width: 200, fontSize: 20, fontFamily: 'Inter',
          fill: '#1e293b', backgroundColor: stickyColor,
          padding: 15,
          shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.3)', blur: 10, offsetX: 5, offsetY: 5 }),
          id: Math.random().toString(36).substr(2, 9)
        });
        canvas.add(sticky);
        canvas.setActiveObject(sticky);
        socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: sticky.toJSON(['id']) } });
        history.current.push(sticky);
        return;
      }

      isDrawingShape.current = true;

      if (tool === 'rect') {
        shapeRef.current = new fabric.Rect({ left: startX.current, top: startY.current, width: 0, height: 0, fill: 'transparent', stroke: colorRef.current, strokeWidth: strokeWidthRef.current, selectable: false, evented: true, id: Math.random().toString(36).substr(2, 9) });
      } else if (tool === 'circle') {
        // Radius must be > 0 initially in some versions
        shapeRef.current = new fabric.Circle({ left: startX.current, top: startY.current, radius: 1, fill: 'transparent', stroke: colorRef.current, strokeWidth: strokeWidthRef.current, selectable: false, evented: true, id: Math.random().toString(36).substr(2, 9) });
      } else if (tool === 'line') {
        shapeRef.current = new fabric.Line([startX.current, startY.current, startX.current, startY.current], { stroke: colorRef.current, strokeWidth: strokeWidthRef.current, selectable: false, evented: true, id: Math.random().toString(36).substr(2, 9) });
      }

      if (shapeRef.current) canvas.add(shapeRef.current);
    });

    canvas.on('mouse:up', () => {
      if (isDraggingCanvas.current) {
        canvas.setViewportTransform(canvas.viewportTransform);
        isDraggingCanvas.current = false;
        canvas.selection = activeToolRef.current === 'select';
        return;
      }

      if (isDrawingShape.current && shapeRef.current) {
        isDrawingShape.current = false;
        shapeRef.current.setCoords();
        socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: shapeRef.current.toJSON(['id']) } });
        history.current.push(shapeRef.current);
        redoStack.current = [];
        shapeRef.current = null;
      }
    });

    // Mouse Wheel Zoom
    canvas.on('mouse:wheel', function (opt) {
      var delta = opt.e.deltaY;
      var zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      if (zoom > 5) zoom = 5;
      if (zoom < 0.1) zoom = 0.1;
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    // Drag & Drop Image
    const handleDrop = (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (f) => {
          fabric.Image.fromURL(f.target.result).then((img) => {
            const maxDim = 500;
            if (img.width > maxDim || img.height > maxDim) {
              const scale = Math.min(maxDim / img.width, maxDim / img.height);
              img.scale(scale);
            }
            // Calculate drop position
            const rect = canvasRef.current.parentElement.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const vpt = canvas.viewportTransform;
            const sceneX = (x - vpt[4]) / vpt[0];
            const sceneY = (y - vpt[5]) / vpt[3];

            img.set({ left: sceneX, top: sceneY, originX: 'center', originY: 'center', id: Math.random().toString(36).substr(2, 9) });
            canvas.add(img);
            canvas.setActiveObject(img);
            canvas.requestRenderAll();
            socket.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: img.toJSON(['id']) } });
            history.current.push(img);
          });
        };
        reader.readAsDataURL(file);
      }
    };
    const handleDragOver = (e) => e.preventDefault();

    const canvasWrapper = canvasRef.current.parentElement;
    canvasWrapper.addEventListener('drop', handleDrop);
    canvasWrapper.addEventListener('dragover', handleDragOver);

    return () => {
      Object.keys(audioContextsRef.current).forEach(id => {
        if (audioContextsRef.current[id]) audioContextsRef.current[id].close();
      });
      audioContextsRef.current = {};

      Object.values(rtcPeersRef.current).forEach(pc => pc.close());
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      window.removeEventListener('resize', handleResize);
      if (canvasWrapper) {
        canvasWrapper.removeEventListener('drop', handleDrop);
        canvasWrapper.removeEventListener('dragover', handleDragOver);
      }
      clearInterval(pingInterval);
      socket.disconnect();
      canvas.dispose();
    };
  }, [roomData.roomId]);

  const monitorAudio = (stream, elementId) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      audioContextsRef.current[elementId] = audioContext;

      const updateVolume = () => {
        if (!audioContextsRef.current[elementId]) return;

        analyser.getByteFrequencyData(dataArray);
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
          if (dataArray[i] > max) max = dataArray[i];
        }
        // max is between 0 and 255
        let volume = Math.min(100, Math.round((max / 255) * 100));

        // Add a small noise gate
        if (volume < 5) volume = 0;

        const el = document.getElementById(elementId);
        if (el) {
          if (volume > 5) {
            el.style.boxShadow = `0 0 0 ${volume / 5}px rgba(34, 197, 94, 0.6)`;
          } else {
            el.style.boxShadow = 'none';
          }
        }

        const percentEl = document.getElementById(elementId + '-percent');
        if (percentEl) {
          percentEl.innerText = `${volume}%`;
        }

        requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch (e) {
      console.error("Audio API error:", e);
    }
  };

  const stopMonitorAudio = (elementId) => {
    if (audioContextsRef.current[elementId]) {
      audioContextsRef.current[elementId].close();
      delete audioContextsRef.current[elementId];
    }
    const el = document.getElementById(elementId);
    if (el) el.style.boxShadow = 'none';
  };

  const toggleMic = async () => {
    if (!isMicOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        localStreamRef.current = stream;
        Object.values(rtcPeersRef.current).forEach(pc => {
          stream.getTracks().forEach(track => pc.addTrack(track, stream));
        });
        setIsMicOn(true);
        monitorAudio(stream, 'audio-indicator-local');
      } catch (err) {
        console.error("Mic access denied", err);
        alert("Microphone access is required for voice chat.");
      }
    } else {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
          // Remove track from all peers
          Object.values(rtcPeersRef.current).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track === track);
            if (sender) pc.removeTrack(sender);
          });
        });
        localStreamRef.current = null;
      }
      setIsMicOn(false);
      stopMonitorAudio('audio-indicator-local');
    }
  };

  // Handle Tool & Color Changes
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    canvas.isDrawingMode = activeTool === 'pen';
    canvas.selection = activeTool === 'select';

    canvas.getObjects().forEach(obj => {
      obj.set('selectable', activeTool === 'select');
      obj.set('evented', activeTool === 'select' || activeTool === 'eraser');
    });
    canvas.discardActiveObject();
    canvas.requestRenderAll();

    if (activeTool === 'pen') {
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = strokeWidth;
    }
  }, [activeTool, color, strokeWidth]);

  // Actions
  const handleClear = () => {
    if (confirm('Clear the entire board for everyone?')) {
      fabricRef.current.clear();
      socketRef.current.emit('clear-board', roomData.roomId);
    }
  };

  const handleDownload = () => {
    const dataURL = fabricRef.current.toDataURL({ format: 'png', quality: 1 });
    const link = document.createElement('a');
    link.download = `whiteboard-${roomData.roomId}.png`;
    link.href = dataURL;
    link.click();
  };

  const handleUndo = () => {
    if (history.current.length === 0) return;
    const canvas = fabricRef.current;
    const obj = history.current.pop();
    redoStack.current.push(obj);
    canvas.remove(obj);
    // Currently we don't broadcast undo easily unless we sync whole canvas or send remove by ID.
    // For this scope, undo applies locally.
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (f) => {
      fabric.Image.fromURL(f.target.result).then((img) => {
        const maxDim = 500;
        if (img.width > maxDim || img.height > maxDim) {
          const scale = Math.min(maxDim / img.width, maxDim / img.height);
          img.scale(scale);
        }

        const canvas = fabricRef.current;
        const vpt = canvas.viewportTransform;
        const centerX = (window.innerWidth / 2 - vpt[4]) / vpt[0];
        const centerY = (window.innerHeight / 2 - vpt[5]) / vpt[3];

        img.set({
          left: centerX,
          top: centerY,
          originX: 'center',
          originY: 'center',
          id: Math.random().toString(36).substr(2, 9)
        });

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();

        socketRef.current.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: img.toJSON(['id']) } });
        history.current.push(img);
      }).catch(err => console.error("Error loading image", err));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') return;
    
    setIsUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      
      const canvas = fabricRef.current;
      const vpt = canvas.viewportTransform;
      const startX = (window.innerWidth / 2 - vpt[4]) / vpt[0];
      let currentY = (window.innerHeight / 2 - vpt[5]) / vpt[3];
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        
        const offscreenCanvas = document.createElement('canvas');
        const context = offscreenCanvas.getContext('2d');
        offscreenCanvas.height = viewport.height;
        offscreenCanvas.width = viewport.width;
        
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        
        const blob = await new Promise(resolve => offscreenCanvas.toBlob(resolve, 'image/png'));
        
        const formData = new FormData();
        formData.append('file', blob, `page-${i}.png`);
        
        const response = await fetch(`${SOCKET_URL}/api/upload`, {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        
        await new Promise(resolve => {
          fabric.Image.fromURL(data.url).then((img) => {
            img.set({
              left: startX,
              top: currentY,
              originX: 'center',
              originY: 'top',
              id: Math.random().toString(36).substr(2, 9)
            });
            
            canvas.add(img);
            canvas.requestRenderAll();
            
            socketRef.current.emit('draw-event', { roomId: roomData.roomId, eventData: { type: 'object-added', object: img.toJSON(['id']) } });
            history.current.push(img);
            
            currentY += viewport.height + 20; // Space between pages
            resolve();
          }).catch(err => {
            console.error("Error loading PDF image", err);
            resolve();
          });
        });
      }
    } catch (err) {
      console.error("Error processing PDF:", err);
      alert(`Failed to process PDF: ${err.message || err}`);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const saveAndLeave = () => {
    const canvas = fabricRef.current;
    if (canvas) {
      // create low-res thumbnail
      const thumbnail = canvas.toDataURL({ format: 'png', quality: 0.5, multiplier: 0.2 });
      const canvasState = canvas.toJSON(['id']);

      fetch('http://localhost:5000/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: roomData.roomId,
          name: roomData.roomId + " Board",
          canvasState,
          thumbnail
        })
      }).then(() => onLeave()).catch(() => onLeave());
    } else {
      onLeave();
    }
  };

  const getLatencyColor = (ms) => {
    if (ms === 0) return 'var(--text-muted)';
    if (ms < 80) return '#22c55e'; // Green
    if (ms < 200) return '#eab308'; // Yellow
    return '#ef4444'; // Red
  };

  const handleZoomIn = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let zoom = canvas.getZoom() * 1.2;
    if (zoom > 5) zoom = 5;
    canvas.zoomToPoint({ x: canvas.width / 2, y: canvas.height / 2 }, zoom);
  };

  const handleZoomOut = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let zoom = canvas.getZoom() / 1.2;
    if (zoom < 0.1) zoom = 0.1;
    canvas.zoomToPoint({ x: canvas.width / 2, y: canvas.height / 2 }, zoom);
  };


  return (
    <div className="canvas-wrapper">
      <div className="header glass-panel">
        <div className="header-title">
          <PenTool size={24} color="var(--accent)" />
          CollabBoard
        </div>
        <div className="room-info">
          <button className={`btn-secondary ${isMicOn ? 'active' : ''}`} onClick={toggleMic} style={{ padding: '0.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: isMicOn ? 'rgba(34, 197, 94, 0.2)' : 'transparent', borderColor: isMicOn ? 'var(--success)' : 'var(--panel-border)', color: isMicOn ? 'var(--success)' : 'var(--text-main)', width: '40px', height: '40px' }} title={isMicOn ? 'Mute' : 'Unmute'}>
            {isMicOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button className="btn-secondary" onClick={saveAndLeave} style={{ padding: '0.5rem 1rem', borderRadius: '9999px', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-main)' }} title="Return to Dashboard">
            <Home size={16} /> Home
          </button>
          <div style={{ position: 'relative' }}>
            <div onClick={() => setShowParticipantsList(!showParticipantsList)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', background: 'rgba(0,0,0,0.5)', borderRadius: '9999px', border: '1px solid var(--panel-border)', color: 'var(--text-main)', cursor: 'pointer' }} title="View Participants">
              <Users size={16} />
              <span style={{ fontWeight: 600 }}>{Object.keys(peers).length + 1}</span>
            </div>
            {showParticipantsList && (
              <div className="glass-panel" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', padding: '1rem', borderRadius: '1rem', minWidth: '220px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontWeight: 600, borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>Participants ({Object.keys(peers).length + 1})</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span id="audio-indicator-local" style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: roomData.userColor, transition: 'box-shadow 0.1s' }}></span>
                    <span style={{ fontWeight: 500 }}>{roomData.userName} (You)</span>
                    <span id="audio-indicator-local-percent" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>0%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: getLatencyColor(latency) }}>
                    <Wifi size={14} /> {latency > 0 ? `${latency}ms` : '...'}
                  </div>
                </div>
                {Object.entries(peers).map(([peerId, p]) => (
                  <div key={peerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span id={`audio-indicator-${peerId}`} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: p.color, transition: 'box-shadow 0.1s' }}></span>
                      <span>{p.name}</span>
                      <span id={`audio-indicator-${peerId}-percent`} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>0%</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: getLatencyColor(p.latency || 0) }}>
                      <Wifi size={14} /> {(p.latency && p.latency > 0) ? `${p.latency}ms` : '...'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', background: 'rgba(0,0,0,0.5)', borderRadius: '9999px', border: '1px solid var(--panel-border)' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: roomData.userColor }}></span>
            <span style={{ fontWeight: 600 }}>{roomData.userName}</span>
          </span>
          <span>Room: <span className="room-code">{roomData.roomId}</span></span>
          <button className="btn danger" onClick={saveAndLeave}>
            <LogOut size={16} /> Save & Leave
          </button>
        </div>
      </div>

      <div className="toolbar glass-panel">
        <button className={`tool-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')} title="Select"><MousePointer2 size={20} /></button>
        <button className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`} onClick={() => setActiveTool('pan')} title="Pan"><Hand size={20} /></button>
        <button className={`tool-btn ${activeTool === 'pen' ? 'active' : ''}`} onClick={() => setActiveTool('pen')} title="Pen"><PenTool size={20} /></button>
        <button className={`tool-btn ${activeTool === 'rect' ? 'active' : ''}`} onClick={() => setActiveTool('rect')} title="Rectangle"><Square size={20} /></button>
        <button className={`tool-btn ${activeTool === 'circle' ? 'active' : ''}`} onClick={() => setActiveTool('circle')} title="Circle"><Circle size={20} /></button>
        <button className={`tool-btn ${activeTool === 'line' ? 'active' : ''}`} onClick={() => setActiveTool('line')} title="Line"><Minus size={20} /></button>
        <button className={`tool-btn ${activeTool === 'sticky' ? 'active' : ''}`} onClick={() => setActiveTool('sticky')} title="Sticky Note"><StickyNote size={20} /></button>
        <button className={`tool-btn ${activeTool === 'text' ? 'active' : ''}`} onClick={() => setActiveTool('text')} title="Text"><Type size={20} /></button>
        <button className={`tool-btn ${activeTool === 'eraser' ? 'active' : ''}`} onClick={() => setActiveTool('eraser')} title="Eraser"><Eraser size={20} /></button>

        <div style={{ height: '1px', background: 'var(--panel-border)', margin: '0.5rem 0' }}></div>

        <button className="tool-btn" onClick={handleUndo} title="Undo"><Undo2 size={20} /></button>
        {/* Redo could be added here */}

        <div style={{ height: '1px', background: 'var(--panel-border)', margin: '0.5rem 0' }}></div>

        <button className="tool-btn" onClick={() => document.getElementById('image-upload').click()} title="Upload Image"><ImageIcon size={20} /></button>
        <input type="file" id="image-upload" style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} />
        <button className="tool-btn" style={{ opacity: isUploading ? 0.5 : 1 }} onClick={() => document.getElementById('pdf-upload').click()} title={isUploading ? "Uploading PDF..." : "Upload PDF"} disabled={isUploading}>
          <FileText size={20} />
        </button>
        <input type="file" id="pdf-upload" style={{ display: 'none' }} accept="application/pdf" onChange={handlePdfUpload} />
        <button className="tool-btn" onClick={handleDownload} title="Download PNG"><Download size={20} /></button>
        <button className="tool-btn" onClick={handleClear} title="Clear Board" style={{ color: 'var(--danger)' }}><Trash2 size={20} /></button>
      </div>

      <div className="properties-panel glass-panel">
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {COLORS.map(c => (
            <div
              key={c}
              className={`color-swatch ${color === c ? 'active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div style={{ width: '1px', height: '24px', background: 'var(--panel-border)', margin: '0 0.5rem' }}></div>
        <input
          type="range"
          min="1" max="20"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
          style={{ width: '100px' }}
        />
      </div>

      <canvas ref={canvasRef} />

      {/* Render Peer Cursors */}
      {Object.entries(peers).map(([id, peer]) => (
        <div key={id} className="remote-cursor" style={{ transform: `translate(${peer.x}px, ${peer.y}px)` }}>
          <MousePointer2 size={16} fill={peer.color} color={peer.color} />
          <div className="cursor-name" style={{ backgroundColor: peer.color }}>{peer.name}</div>
        </div>
      ))}

      {/* Zoom Controls */}
      <div className="glass-panel" style={{ position: 'absolute', bottom: '2rem', right: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem', borderRadius: '1rem', zIndex: 50 }}>
        <button className="btn-secondary" onClick={handleZoomIn} style={{ padding: '0.5rem', borderRadius: '0.5rem', cursor: 'pointer', color: 'var(--text-main)', border: 'none', background: 'transparent' }} title="Zoom In">
          <ZoomIn size={20} />
        </button>
        <button className="btn-secondary" onClick={handleZoomOut} style={{ padding: '0.5rem', borderRadius: '0.5rem', cursor: 'pointer', color: 'var(--text-main)', border: 'none', background: 'transparent' }} title="Zoom Out">
          <ZoomOut size={20} />
        </button>
      </div>
    </div>
  );
}
