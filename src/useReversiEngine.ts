import { useState, useCallback, useRef } from 'react';
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

export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game>(new Game());
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [thinking, setThinking] = useState(false);
  const [state, setState] = useState<GameState>(() => readGameState(gameRef.current, null, []));

  const thinkingRef = useRef(false);
  const modeRef = useRef<GameMode>('ai');
  const difficultyRef = useRef(5);

  const syncState = useCallback((lastMove: number | null, flipped: number[]) => {
    const s = readGameState(gameRef.current, lastMove, flipped);
    setState(s);
    return s;
  }, []);

  const doAiMove = useCallback(() => {
    const game = gameRef.current;
    if (thinkingRef.current) return;
    if (game.is_game_over()) { setPhase('gameover'); return; }
    if (game.current_turn() !== 2) return;

    // Node budget (30K) guarantees completion regardless of depth
    const d = difficultyRef.current;
    const depth = d <= 3 ? 2 : d <= 6 ? 3 : d <= 8 ? 4 : 5;
    setThinking(true);
    thinkingRef.current = true;

    setTimeout(() => {
      const g = gameRef.current;
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
        const s = syncState(move, flipped);
        if (s.isGameOver) {
          setPhase('gameover');
          setThinking(false);
          thinkingRef.current = false;
          return;
        }
        if (g.current_turn() === 2) {
          setThinking(false);
          thinkingRef.current = false;
          setTimeout(() => doAiMove(), 300);
          return;
        }
      } else {
        syncState(null, []);
        if (g.is_game_over()) setPhase('gameover');
      }

      setThinking(false);
      thinkingRef.current = false;
    }, 50);
  }, [syncState]);

  const playMove = useCallback((pos: number) => {
    if (thinkingRef.current) return;
    const game = gameRef.current;

    const boardBefore = game.get_board();
    const ok = game.make_move(pos);
    if (!ok) return;

    const boardAfter = game.get_board();
    const flipped: number[] = [];
    for (let i = 0; i < 64; i++) {
      if (i !== pos && boardBefore[i] !== boardAfter[i]) flipped.push(i);
    }

    const s = syncState(pos, flipped);
    if (s.isGameOver) { setPhase('gameover'); return; }

    if (modeRef.current === 'ai' && game.current_turn() === 2) {
      doAiMove();
    }
  }, [syncState, doAiMove]);

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
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('lobby');
    setThinking(false);
    thinkingRef.current = false;
  }, []);

  return { state, phase, mode, difficulty, thinking, ready: true, startGame, playMove, newGame };
}
