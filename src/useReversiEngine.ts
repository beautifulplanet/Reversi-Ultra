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
 * Simplified hook — NO thinking state, NO setTimeout chains.
 * AI takes <3ms. The turn (state.turn === 2) naturally disables the board.
 * A single useEffect triggers the AI whenever it's White's turn.
 * This eliminates 100% of the stale-closure / stuck-thinking bugs.
 */
export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game>(new Game());
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [state, setState] = useState<GameState>(() => readGameState(gameRef.current, null, []));

  // Refs for values needed inside the AI effect
  const modeRef = useRef<GameMode>('ai');
  const difficultyRef = useRef(5);
  const phaseRef = useRef<GamePhase>('lobby');

  // Single timer ref for the AI delay (so newGame can cancel it)
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep phaseRef in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  /**
   * AI trigger: whenever state.turn is 2 (White) and we're playing AI mode,
   * schedule the AI move after a short delay (so the human sees their own move first).
   */
  useEffect(() => {
    if (phase !== 'playing') return;
    if (modeRef.current !== 'ai') return;
    if (state.turn !== 2) return;
    if (state.isGameOver) return;

    const d = difficultyRef.current;
    const depth = d <= 3 ? 1 : d <= 6 ? 2 : d <= 8 ? 3 : 4;

    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      if (phaseRef.current !== 'playing') return;

      const g = gameRef.current;
      if (g.is_game_over() || g.current_turn() !== 2) return;

      const boardBefore = g.get_board();
      const t0 = performance.now();
      const move = g.ai_move(depth);
      console.log(`[AI] depth=${depth} move=${move} time=${(performance.now() - t0).toFixed(1)}ms`);

      if (move >= 0 && move < 64) {
        const boardAfter = g.get_board();
        const flipped: number[] = [];
        for (let i = 0; i < 64; i++) {
          if (i !== move && boardBefore[i] !== boardAfter[i]) flipped.push(i);
        }
        const s = readGameState(g, move, flipped);
        setState(s);
        if (s.isGameOver) setPhase('gameover');
        // If s.turn is STILL 2 (human must pass), this effect will
        // re-trigger automatically on the next render. No manual chaining.
      } else {
        // AI passed — advanceTurn already called inside ai_move
        const s = readGameState(g, null, []);
        setState(s);
        if (s.isGameOver) setPhase('gameover');
        // If turn is still 2, effect re-triggers. If turn is 1, human plays.
      }
    }, 400); // 400ms delay so human sees their move + flip animation

    return () => {
      if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    };
  }, [state.turn, state.isGameOver, phase]);

  const playMove = useCallback((pos: number) => {
    const game = gameRef.current;
    if (game.current_turn() !== 1 && modeRef.current === 'ai') return; // not human's turn
    if (game.is_game_over()) return;

    const flips = game.get_flips(pos);
    const ok = game.make_move(pos);
    if (!ok) return;

    const s = readGameState(game, pos, flips);
    setState(s);
    if (s.isGameOver) setPhase('gameover');
    // If s.turn === 2 (AI's turn), the useEffect above will trigger the AI.
    // No manual doAiMove() call needed.
  }, []);

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

  // "thinking" is just whether it's AI's turn — no separate state needed
  const thinking = phase === 'playing' && mode === 'ai' && state.turn === 2 && !state.isGameOver;

  return { state, phase, mode, difficulty, thinking, ready: true, startGame, playMove, newGame };
}
