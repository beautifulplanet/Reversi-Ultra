import { useState, useCallback, useEffect, useRef } from 'react';
import init, { Game } from '../reversi-engine/pkg/reversi_engine';

export type CellState = 0 | 1 | 2; // 0=empty, 1=black, 2=white
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
    board: Array.from(game.get_board()) as CellState[],
    turn: game.current_turn() as 1 | 2,
    legalMoves: Array.from(game.get_legal_moves()),
    blackCount: game.black_count(),
    whiteCount: game.white_count(),
    isGameOver: game.is_game_over(),
    lastMove,
    flippedDiscs: flipped,
  };
}

/** Create a fresh Game, recovering from any WASM corruption */
function freshGame(): Game {
  return new Game();
}

export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [thinking, setThinking] = useState(false);
  const thinkingRef = useRef(false);
  const modeRef = useRef<GameMode>('ai');
  const difficultyRef = useRef(5);
  const [state, setState] = useState<GameState>({
    board: Array(64).fill(0) as CellState[],
    turn: 1,
    legalMoves: [],
    blackCount: 0,
    whiteCount: 0,
    isGameOver: false,
    lastMove: null,
    flippedDiscs: [],
  });

  // Keep refs in sync with state
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);

  // Initialize WASM — only once (guard against StrictMode double-mount)
  const initCalled = useRef(false);
  useEffect(() => {
    if (initCalled.current) return;
    initCalled.current = true;
    init().then(() => {
      const game = freshGame();
      gameRef.current = game;
      setState(readGameState(game, null, []));
      setReady(true);
    }).catch((err) => {
      console.error('WASM init failed:', err);
    });
  }, []);

  const syncState = useCallback((lastMove: number | null, flipped: number[]) => {
    if (!gameRef.current) return;
    try {
      const s = readGameState(gameRef.current, lastMove, flipped);
      setState(s);
      return s;
    } catch {
      // WASM object corrupted — recover with fresh game
      console.error('WASM state read failed, resetting game');
      const game = freshGame();
      gameRef.current = game;
      const s = readGameState(game, null, []);
      setState(s);
      setPhase('lobby');
      return s;
    }
  }, []);

  const startGame = useCallback((m: GameMode, diff: number) => {
    if (!gameRef.current) return;
    setMode(m);
    modeRef.current = m;
    setDifficulty(diff);
    difficultyRef.current = diff;
    try {
      gameRef.current.reset();
    } catch {
      gameRef.current = freshGame();
    }
    setState(readGameState(gameRef.current, null, []));
    setPhase('playing');
  }, []);

  const doAiMove = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;

    try {
      if (game.is_game_over()) {
        setPhase('gameover');
        return;
      }
      if (game.current_turn() !== 2) return;
    } catch {
      // WASM corrupted — recover
      gameRef.current = freshGame();
      setState(readGameState(gameRef.current, null, []));
      setPhase('lobby');
      setThinking(false);
      thinkingRef.current = false;
      return;
    }

    if (thinkingRef.current) return;

    const depth = Math.min(8, Math.max(1, Math.ceil(difficultyRef.current * 0.8)));
    setThinking(true);
    thinkingRef.current = true;

    setTimeout(() => {
      try {
        const boardBefore = Array.from(game.get_board());
        const move = game.ai_move(depth);

        if (move >= 0 && move < 64) {
          const boardAfter = Array.from(game.get_board());
          const flipped: number[] = [];
          for (let i = 0; i < 64; i++) {
            if (i !== move && boardBefore[i] !== boardAfter[i]) {
              flipped.push(i);
            }
          }
          const s = syncState(move, flipped);

          if (s && s.isGameOver) {
            setPhase('gameover');
            setThinking(false);
            thinkingRef.current = false;
            return;
          }

          // Human must pass → chain another AI move
          if (game.current_turn() === 2) {
            setThinking(false);
            thinkingRef.current = false;
            setTimeout(() => doAiMove(), 300);
            return;
          }
        } else {
          // AI passed
          syncState(null, []);
          if (game.is_game_over()) {
            setPhase('gameover');
            setThinking(false);
            thinkingRef.current = false;
            return;
          }
        }
      } catch (err) {
        console.error('AI move failed, recovering:', err);
        // WASM object corrupted after panic — create fresh game
        gameRef.current = freshGame();
        setState(readGameState(gameRef.current, null, []));
        setPhase('lobby');
      }

      setThinking(false);
      thinkingRef.current = false;
    }, 50);
  }, [syncState]);

  const playMove = useCallback((pos: number) => {
    if (!gameRef.current || thinkingRef.current) return;
    const game = gameRef.current;

    try {
      const boardBefore = Array.from(game.get_board());
      const ok = game.make_move(pos);
      if (!ok) return;

      const boardAfter = Array.from(game.get_board());
      const flipped: number[] = [];
      for (let i = 0; i < 64; i++) {
        if (i !== pos && boardBefore[i] !== boardAfter[i]) {
          flipped.push(i);
        }
      }

      const s = syncState(pos, flipped);
      if (s && s.isGameOver) {
        setPhase('gameover');
        return;
      }

      if (modeRef.current === 'ai' && game.current_turn() === 2) {
        doAiMove();
      }
    } catch (err) {
      console.error('Move failed, recovering:', err);
      // WASM object corrupted — create fresh game
      gameRef.current = freshGame();
      setState(readGameState(gameRef.current, null, []));
      setPhase('lobby');
    }
  }, [syncState, doAiMove]);

  const newGame = useCallback(() => {
    try {
      if (gameRef.current) {
        gameRef.current.reset();
      } else {
        gameRef.current = freshGame();
      }
    } catch {
      gameRef.current = freshGame();
    }
    setState(readGameState(gameRef.current!, null, []));
    setPhase('lobby');
    setThinking(false);
    thinkingRef.current = false;
  }, []);

  return { state, phase, mode, difficulty, thinking, ready, startGame, playMove, newGame };
}
