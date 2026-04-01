import { useState } from 'react';
import { useReversiEngine, type GameMode } from './useReversiEngine';
import ReversiBoard from './ReversiBoard';
import './styles/global.css';

export default function App() {
  const engine = useReversiEngine();

  if (!engine.ready) {
    return (
      <div className="app-container">
        <div className="loading">Loading engine…</div>
      </div>
    );
  }

  if (engine.phase === 'lobby') {
    return <Lobby onStart={engine.startGame} />;
  }

  return <GameView engine={engine} />;
}

/* ── Lobby ── */
function Lobby({ onStart }: { onStart: (mode: GameMode, diff: number) => void }) {
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);

  return (
    <div className="app-container">
      <div className="lobby">
        <h1 className="lobby-title">Reversi Ultra</h1>
        <p className="lobby-subtitle">Classic board game. Rust engine. Your move.</p>

        <div className="lobby-section">
          <label className="lobby-label">Mode</label>
          <div className="button-row">
            <button
              className={`mode-btn${mode === 'ai' ? ' active' : ''}`}
              onClick={() => setMode('ai')}
            >
              vs AI
            </button>
            <button
              className={`mode-btn${mode === 'pvp' ? ' active' : ''}`}
              onClick={() => setMode('pvp')}
            >
              Local PvP
            </button>
          </div>
        </div>

        {mode === 'ai' && (
          <div className="lobby-section">
            <label className="lobby-label">
              Difficulty: <span className="mono">{difficulty}</span>
            </label>
            <div className="diff-row">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  className={`diff-btn${n === difficulty ? ' active' : ''}`}
                  onClick={() => setDifficulty(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <button className="start-btn" onClick={() => onStart(mode, difficulty)}>
          Start Game
        </button>
      </div>
    </div>
  );
}

/* ── Game View ── */
function GameView({ engine }: { engine: ReturnType<typeof useReversiEngine> }) {
  const { state, phase, mode, thinking, newGame, playMove } = engine;
  const turnLabel = state.turn === 1 ? '● Black' : '○ White';
  const isPlayerTurn = mode === 'pvp' || state.turn === 1;

  let winner = '';
  if (phase === 'gameover') {
    if (state.blackCount > state.whiteCount) winner = '● Black wins!';
    else if (state.whiteCount > state.blackCount) winner = '○ White wins!';
    else winner = "It's a tie!";
  }

  return (
    <div className="app-container">
      <div className="game-layout">
        <div className="side-panel">
          <h2 className="game-name">Reversi Ultra</h2>

          <div className="score-card">
            <div className="score-row">
              <span className="disc-black">●</span>
              <span>Black</span>
              <span className="mono score-num">{state.blackCount}</span>
            </div>
            <div className="score-row">
              <span className="disc-white">○</span>
              <span>White</span>
              <span className="mono score-num">{state.whiteCount}</span>
            </div>
          </div>

          {phase === 'gameover' ? (
            <div className="game-over-box">
              <div className="winner-text">{winner}</div>
              <div className="mono final-score">
                {state.blackCount} – {state.whiteCount}
              </div>
            </div>
          ) : (
            <div className="turn-info">
              <span>Turn: {turnLabel}</span>
              {thinking && <span className="thinking-text">AI thinking…</span>}
            </div>
          )}

          <button className="new-game-btn" onClick={newGame}>
            New Game
          </button>
        </div>

        <ReversiBoard
          board={state.board}
          legalMoves={isPlayerTurn && !thinking ? state.legalMoves : []}
          lastMove={state.lastMove}
          flippedDiscs={state.flippedDiscs}
          turn={state.turn}
          disabled={!isPlayerTurn || thinking || phase === 'gameover'}
          onCellClick={playMove}
        />
      </div>
    </div>
  );
}
