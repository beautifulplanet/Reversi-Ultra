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
  const boardArr = game.get_board();
  const board = Array.from(boardArr) as CellState[];
  const movesArr = game.get_legal_moves();
  const legalMoves = Array.from(movesArr);
  return {
    board,
    turn: game.current_turn() as 1 | 2,
    legalMoves,
    blackCount: game.black_count(),
    whiteCount: game.white_count(),
    isGameOver: game.is_game_over(),
    lastMove,
    flippedDiscs: flipped,
  };
}

export function useReversiEngine(): ReversiEngine {
  const gameRef = useRef<Game | null>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [mode, setMode] = useState<GameMode>('ai');
  const [difficulty, setDifficulty] = useState(5);
  const [thinking, setThinking] = useState(false);
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

  // Initialize WASM
  useEffect(() => {
    init().then(() => {
      const game = new Game();
      gameRef.current = game;
      setState(readGameState(game, null, []));
      setReady(true);
    });
  }, []);

  const syncState = useCallback((lastMove: number | null, flipped: number[]) => {
    if (!gameRef.current) return;
    const s = readGameState(gameRef.current, lastMove, flipped);
    setState(s);
    return s;
  }, []);

  const startGame = useCallback((m: GameMode, diff: number) => {
    if (!gameRef.current) return;
    setMode(m);
    setDifficulty(diff);
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('playing');
  }, []);

  const doAiMove = useCallback(() => {
    if (!gameRef.current) return;
    const game = gameRef.current;
    if (game.is_game_over()) {
      setPhase('gameover');
      return;
    }

    // Only proceed if it's actually the AI's turn (White = 2)
    if (game.current_turn() !== 2) return;

    // Map difficulty 1-10 to depth 1-8
    const depth = Math.min(8, Math.max(1, Math.ceil(difficulty * 0.8)));
    setThinking(true);
    setTimeout(() => {
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
          return;
        }
        // After AI moves, if human must pass (turn is still White), chain AI again
        if (game.current_turn() === 2) {
          setThinking(false);
          setTimeout(() => doAiMove(), 300); // small delay so flip animation plays
          return;
        }
      } else {
        // AI had no move (pass) — sync and check
        syncState(null, []);
        if (game.is_game_over()) {
          setPhase('gameover');
          setThinking(false);
          return;
        }
        // After AI pass, if it's still AI's turn (shouldn't happen, but safety)
        if (game.current_turn() === 2) {
          setThinking(false);
          setTimeout(() => doAiMove(), 300);
          return;
        }
      }
      setThinking(false);
    }, 50);
  }, [difficulty, syncState]);

  const playMove = useCallback((pos: number) => {
    if (!gameRef.current || thinking) return;
    const game = gameRef.current;
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

    // If AI mode and it's now the AI's turn (White = 2), trigger AI
    if (mode === 'ai' && game.current_turn() === 2) {
      doAiMove();
    }
  }, [thinking, syncState, mode, doAiMove]);

  const newGame = useCallback(() => {
    if (!gameRef.current) return;
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('lobby');
    setThinking(false);
  }, []);

  return { state, phase, mode, difficulty, thinking, ready, startGame, playMove, newGame };
}
