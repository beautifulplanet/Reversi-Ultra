import { useState, useCallback, useRef, useEffect } from 'react';
import { Game } from './engine';

export type CellState = 0 | 1 | 2;
export type GamePhase = 'lobby' | 'playing' | 'gameover';
export type GameMode = 'ai' | 'pvp';

export interface GameState {
  board: CellState[];
  turn: 1 | 2;
  legalMoves: number[];
  blackCount: number;
  whiteCount: number;
  isGameOver: boolean;
  lastMove: number | null;
  flippedDiscs: number[];
}

export interface ReversiEngine {
  state: GameState;
  phase: GamePhase;
  mode: GameMode;
  difficulty: number;
  thinking: boolean;
  ready: boolean;
  startGame: (mode: GameMode, difficulty: number) => void;
  playMove: (pos: number) => void;
  newGame: () => void;
}

function readGameState(game: Game, lastMove: number | null, flipped: number[]): GameState {
  return {
    board: game.get_board() as CellState[],
    turn: game.current_turn() as 1 | 2,
    legalMoves: game.get_legal_moves(),
    blackCount: game.black_count(),
    whiteCount: game.white_count(),
    isGameOver: game.is_game_over(),
    lastMove,
    flippedDiscs: flipped,
  };
}

/**
 * Hook with explicit AI triggering — NO useEffect dependency on state.turn.
 *
 * The old useEffect approach broke when turn stayed 2 after AI moved (human
 * must pass). React effects fire on dependency CHANGES — if turn was 2 and
 * is still 2, the effect doesn't re-fire. 2.5% of games hit this.
 *
 * Fix: doAiMove is called explicitly from playMove and from itself (via
 * setTimeout). All game state is read through refs, so no stale closures.
 */
export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game>(new Game());
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [state, setState] = useState<GameState>(() => readGameState(gameRef.current, null, []));

  // Refs so callbacks always see current values (no stale closures)
  const modeRef = useRef<GameMode>('ai');
  const difficultyRef = useRef(5);
  const phaseRef = useRef<GamePhase>('lobby');
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // doAiMove: called explicitly, never via useEffect dependency matching.
  // Uses only refs and stable setState — zero closure staleness risk.
  const doAiMove = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.is_game_over() || g.current_turn() !== 2) return;
    if (phaseRef.current !== 'playing' || modeRef.current !== 'ai') return;

    const d = difficultyRef.current;
    const depth = d <= 3 ? 1 : d <= 6 ? 2 : d <= 8 ? 3 : 4;

    const boardBefore = g.get_board();
    const t0 = performance.now();
    const move = g.ai_move(depth);
    console.log(`[AI] depth=${depth} move=${move} time=${(performance.now() - t0).toFixed(1)}ms`);

    let flipped: number[] = [];
    if (move >= 0 && move < 64) {
      const boardAfter = g.get_board();
      for (let i = 0; i < 64; i++) {
        if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
      }
    }

    const s = readGameState(g, move >= 0 ? move : null, flipped);
    setState(s);

    if (s.isGameOver) { setPhase('gameover'); return; }

    // If turn is STILL 2 (human must pass), chain another AI move.
    // This is the fix: we don't rely on useEffect re-triggering.
    if (g.current_turn() === 2) {
      aiTimerRef.current = setTimeout(doAiMove, 400);
    }
  }, []);

  const playMove = useCallback((pos: number) => {
    const g = gameRef.current;
    if (!g || g.is_game_over()) return;
    if (modeRef.current === 'ai' && g.current_turn() !== 1) return;

    const flips = g.get_flips(pos);
    const ok = g.make_move(pos);
    if (!ok) return;

    const s = readGameState(g, pos, flips);
    setState(s);

    if (s.isGameOver) { setPhase('gameover'); return; }

    // Explicitly trigger AI if it's now White's turn
    if (modeRef.current === 'ai' && g.current_turn() === 2) {
      aiTimerRef.current = setTimeout(doAiMove, 400);
    }
  }, [doAiMove]);

  const startGame = useCallback((m: GameMode, diff: number) => {
    setMode(m);
    modeRef.current = m;
    setDifficulty(diff);
    difficultyRef.current = diff;
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('playing');
  }, []);

  const newGame = useCallback(() => {
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('lobby');
  }, []);

  const thinking = phase === 'playing' && mode === 'ai' && state.turn === 2 && !state.isGameOver;

  return { state, phase, mode, difficulty, thinking, ready: true, startGame, playMove, newGame };
}
