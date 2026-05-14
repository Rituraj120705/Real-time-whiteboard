import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { PenTool } from 'lucide-react';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

export default function JoinModal({ onJoin, initialRoomId = '', onBack }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(initialRoomId);
  
  const handleCreate = () => {
    if (!name.trim()) return alert('Please enter your name');
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    onJoin({ roomId: newRoomId, userName: name, userColor: color });
  };

  const handleJoin = () => {
    if (!name.trim()) return alert('Please enter your name');
    if (!roomId.trim()) return alert('Please enter a room code');
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    onJoin({ roomId: roomId.toUpperCase(), userName: name, userColor: color });
  };

  return (
    <div className="modal-overlay">
      <div className="modal glass-panel">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem', position: 'relative' }}>
          {onBack && <button onClick={onBack} style={{position: 'absolute', left: 0, top: 0, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', marginTop: '10px'}}>← Back</button>}
          <PenTool size={48} color="var(--accent)" />
        </div>
        <h2>CollabBoard</h2>
        
        <div className="input-group">
          <label>Your Name</label>
          <input 
            type="text" 
            className="input-field" 
            placeholder="e.g. Alex" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />
        </div>

        <div className="input-group">
          <label>Room Code (optional)</label>
          <input 
            type="text" 
            className="input-field" 
            placeholder="e.g. X7B9K2" 
            value={roomId} 
            onChange={(e) => setRoomId(e.target.value)} 
            maxLength={6}
          />
        </div>

        <div className="modal-actions">
          {roomId.trim() ? (
            <button className="btn" onClick={handleJoin}>Join Room</button>
          ) : (
            <button className="btn" onClick={handleCreate}>Create New Room</button>
          )}
        </div>
      </div>
    </div>
  );
}
