import React, { useState, useEffect } from 'react';
import JoinModal from './components/JoinModal';
import Whiteboard from './components/Whiteboard';
import Dashboard from './components/Dashboard';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return <div style={{color:'red', padding: '2rem'}}><h1>App Crashed</h1><pre>{this.state.error.stack}</pre></div>;
    }
    return this.props.children;
  }
}

function App() {
  const [view, setView] = useState('dashboard'); // 'dashboard', 'join', 'whiteboard'
  const [roomData, setRoomData] = useState(null); // { roomId, userName, userColor }
  const [prefilledRoomId, setPrefilledRoomId] = useState('');

  const handleJoinRoom = (roomId) => {
    setPrefilledRoomId(roomId);
    setView('join');
  };

  const handleCreateNew = () => {
    setPrefilledRoomId('');
    setView('join');
  };

  let content;
  if (view === 'dashboard') {
    content = <Dashboard onCreateNew={handleCreateNew} onJoinRoom={handleJoinRoom} />;
  } else if (view === 'join') {
    content = <JoinModal onJoin={(data) => { setRoomData(data); setView('whiteboard'); }} initialRoomId={prefilledRoomId} onBack={() => setView('dashboard')} />;
  } else if (view === 'whiteboard') {
    content = <Whiteboard roomData={roomData} onLeave={() => { setRoomData(null); setView('dashboard'); }} />;
  }

  return (
    <ErrorBoundary>
      <div className="app-container">
        {content}
      </div>
    </ErrorBoundary>
  );
}

export default App;
