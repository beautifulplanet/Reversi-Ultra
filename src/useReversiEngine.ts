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
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    const d = difficultyRef.current;
    const depth = d <= 3 ? 1 : d <= 6 ? 2 : d <= 8 ? 3 : 4;
    thinkingRef.current = true;
    setThinking(true);

    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      const g = gameRef.current;

      try {
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
          } else if (g.current_turn() === 2) {
            // Human must pass — AI goes again after short delay
            thinkingRef.current = false;
            setThinking(false);
            aiTimerRef.current = setTimeout(() => doAiMove(), 300);
            return;
          }
        } else {
          // AI passed (returned -1 but advanceTurn was called inside ai_move)
          syncState(null, []);
          if (g.is_game_over()) setPhase('gameover');
        }
      } catch (err) {
        console.error('[AI] error:', err);
      }

      thinkingRef.current = false;
      setThinking(false);
    }, 50);
  }, [syncState]);

  const playMove = useCallback((pos: number) => {
    if (thinkingRef.current) return;
    const game = gameRef.current;

    // Get flips BEFORE making the move (for animation)
    const flips = game.get_flips(pos);
    const ok = game.make_move(pos);
    if (!ok) return;

    const s = syncState(pos, flips);
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
    // Cancel any pending AI timeout
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    gameRef.current.reset();
    setState(readGameState(gameRef.current, null, []));
    setPhase('lobby');
    setThinking(false);
    thinkingRef.current = false;
  }, []);

  return { state, phase, mode, difficulty, thinking, ready: true, startGame, playMove, newGame };
}
