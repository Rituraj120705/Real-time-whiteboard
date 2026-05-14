import React, { useEffect, useState } from 'react';
import { Plus, LayoutDashboard, Clock, Trash2 } from 'lucide-react';

export default function Dashboard({ onCreateNew, onJoinRoom }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:5000/api/boards')
      .then(res => res.json())
      .then(data => {
        setBoards(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch boards", err);
        setLoading(false);
      });
  }, []);

  const handleDeleteBoard = (e, roomId) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this board?')) {
      fetch(`http://localhost:5000/api/boards/${roomId}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => {
          setBoards(boards.filter(b => b.roomId !== roomId));
        })
        .catch(err => console.error("Failed to delete board", err));
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header glass-panel">
        <div className="header-title">
          <LayoutDashboard size={24} color="var(--accent)" />
          Your CollabBoards
        </div>
        <button className="btn primary" onClick={onCreateNew}>
          <Plus size={16} /> New Board
        </button>
      </div>

      <div className="dashboard-content">
        {loading ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '2rem' }}>Loading boards...</div>
        ) : boards.length === 0 ? (
          <div className="empty-state">
            <LayoutDashboard size={48} color="var(--panel-border)" style={{ marginBottom: '1rem' }} />
            <h2>No saved boards yet</h2>
            <p>Create a new board to start collaborating!</p>
          </div>
        ) : (
          <div className="board-grid">
            {boards.map(board => (
              <div key={board.roomId} className="board-card glass-panel" onClick={() => onJoinRoom(board.roomId)}>
                <div className="board-thumbnail" style={{ backgroundImage: `url(${board.thumbnail || ''})` }}>
                  {!board.thumbnail && <div className="no-thumb">No Thumbnail</div>}
                </div>
                <div className="board-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3>{board.name}</h3>
                    <div className="board-meta">
                      <Clock size={12} /> 
                      {new Date(board.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button 
                    style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }} 
                    onClick={(e) => handleDeleteBoard(e, board.roomId)}
                    title="Delete Board"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
