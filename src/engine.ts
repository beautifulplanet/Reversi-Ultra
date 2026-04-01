/**
 * Pure TypeScript Reversi engine.
 * Same API as the WASM Game class — drop-in replacement.
 * Array-based board + minimax AI with alpha-beta pruning.
 */

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

const POS_WEIGHTS = [
  100, -20,  10,   5,   5,  10, -20, 100,
  -20, -50,  -2,  -2,  -2,  -2, -50, -20,
   10,  -2,   1,   0,   0,   1,  -2,  10,
    5,  -2,   0,   0,   0,   0,  -2,   5,
    5,  -2,   0,   0,   0,   0,  -2,   5,
   10,  -2,   1,   0,   0,   1,  -2,  10,
  -20, -50,  -2,  -2,  -2,  -2, -50, -20,
  100, -20,  10,   5,   5,  10, -20, 100,
];

const CORNERS = [0, 7, 56, 63];
const X_SQUARES: [number, number][] = [[9, 0], [14, 7], [49, 56], [54, 63]];
const C_SQUARES: [number, number][] = [
  [1, 0], [8, 0], [6, 7], [15, 7],
  [48, 56], [57, 56], [55, 63], [62, 63],
];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

/** Get positions flipped by placing `color` at `pos`. */
function getFlips(board: number[], pos: number, color: number): number[] {
  if (board[pos] !== 0) return [];
  const opp = 3 - color;
  const r0 = Math.floor(pos / 8);
  const c0 = pos % 8;
  const allFlips: number[] = [];

  for (const [dr, dc] of DIRS) {
    const line: number[] = [];
    let r = r0 + dr, c = c0 + dc;
    while (inBounds(r, c) && board[r * 8 + c] === opp) {
      line.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    if (line.length > 0 && inBounds(r, c) && board[r * 8 + c] === color) {
      allFlips.push(...line);
    }
  }
  return allFlips;
}

function getLegalMoves(board: number[], color: number): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (getFlips(board, i, color).length > 0) moves.push(i);
  }
  return moves;
}

function hasMoves(board: number[], color: number): boolean {
  for (let i = 0; i < 64; i++) {
    if (board[i] === 0 && getFlips(board, i, color).length > 0) return true;
  }
  return false;
}

function applyMove(board: number[], pos: number, color: number): number[] {
  const next = board.slice();
  const flips = getFlips(board, pos, color);
  next[pos] = color;
  for (const f of flips) next[f] = color;
  return next;
}

function countDiscs(board: number[], color: number): number {
  let c = 0;
  for (let i = 0; i < 64; i++) if (board[i] === color) c++;
  return c;
}

// ── Evaluation ──

function evaluate(board: number[], aiColor: number): number {
  const opp = 3 - aiColor;
  const total = countDiscs(board, 1) + countDiscs(board, 2);
  const phase = Math.max(0, Math.min(1, (total - 4) / 56));
  const early = 1 - phase;
  const late = phase;

  // Position weights — O(64), no getLegalMoves
  let posScore = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === aiColor) posScore += POS_WEIGHTS[i];
    else if (board[i] === opp) posScore -= POS_WEIGHTS[i];
  }

  // Corner control
  let myCorners = 0, oppCorners = 0;
  for (const c of CORNERS) {
    if (board[c] === aiColor) myCorners++;
    else if (board[c] === opp) oppCorners++;
  }
  const cornerDiff = (myCorners - oppCorners) * 100;

  // Danger squares (X and C squares near empty corners)
  let myDanger = 0, oppDanger = 0;
  for (const [sq, corner] of X_SQUARES) {
    if (board[corner] === 0) {
      if (board[sq] === aiColor) myDanger += 50;
      else if (board[sq] === opp) oppDanger += 50;
    }
  }
  for (const [sq, corner] of C_SQUARES) {
    if (board[corner] === 0) {
      if (board[sq] === aiColor) myDanger += 20;
      else if (board[sq] === opp) oppDanger += 20;
    }
  }
  const dangerDiff = oppDanger - myDanger;

  // Disc count (matters in endgame)
  const myCount = countDiscs(board, aiColor);
  const oppCount = countDiscs(board, opp);
  const discDiff = myCount - oppCount;

  // Parity
  const empty = 64 - total;
  const parity = empty % 2 === 0 ? -1 : 1;

  return cornerDiff
    + dangerDiff
    + Math.round(posScore * early)
    + Math.round(discDiff * late * 3)
    + Math.round(parity * late * 15);
}

// ── Minimax with Alpha-Beta + Node Budget ──

let _nodeCount = 0;
const MAX_NODES = 30000; // hard cap — guarantees <200ms in JS

function minimax(
  board: number[], depth: number, alpha: number, beta: number,
  maximizing: boolean, aiColor: number
): number {
  _nodeCount++;
  if (_nodeCount > MAX_NODES || depth === 0) return evaluate(board, aiColor);

  const current = maximizing ? aiColor : 3 - aiColor;
  const moves = getLegalMoves(board, current);

  if (moves.length === 0) {
    if (!hasMoves(board, 3 - current)) {
      return evaluate(board, aiColor); // game over
    }
    // Pass — decrement depth to guarantee termination
    return minimax(board, depth - 1, alpha, beta, !maximizing, aiColor);
  }

  // Move ordering: corners first, then by position weight
  moves.sort((a, b) => POS_WEIGHTS[b] - POS_WEIGHTS[a]);

  if (maximizing) {
    let maxEval = -Infinity;
    for (const pos of moves) {
      if (_nodeCount > MAX_NODES) break;
      const next = applyMove(board, pos, current);
      const val = minimax(next, depth - 1, alpha, beta, false, aiColor);
      maxEval = Math.max(maxEval, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const pos of moves) {
      if (_nodeCount > MAX_NODES) break;
      const next = applyMove(board, pos, current);
      const val = minimax(next, depth - 1, alpha, beta, true, aiColor);
      minEval = Math.min(minEval, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function bestMove(board: number[], color: number, depthLimit: number): number {
  const moves = getLegalMoves(board, color);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0];

  moves.sort((a, b) => POS_WEIGHTS[b] - POS_WEIGHTS[a]);

  let best = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity; // narrow window at root

  _nodeCount = 0; // reset budget

  for (const pos of moves) {
    if (_nodeCount > MAX_NODES) break;
    const next = applyMove(board, pos, color);
    const score = minimax(next, depthLimit - 1, alpha, Infinity, false, color);
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
    alpha = Math.max(alpha, score);
  }
  return best;
}

// ── Game class (same API as WASM Game) ──

function initialBoard(): number[] {
  const b = new Array(64).fill(0);
  b[27] = 2; b[28] = 1; // standard Reversi opening
  b[35] = 1; b[36] = 2;
  return b;
}

export class Game {
  private board: number[];
  private turn: number; // 1=black, 2=white
  private over: boolean;

  constructor() {
    this.board = initialBoard();
    this.turn = 1;
    this.over = false;
  }

  get_board(): number[] {
    return this.board.slice();
  }

  get_legal_moves(): number[] {
    return getLegalMoves(this.board, this.turn);
  }

  current_turn(): number {
    return this.turn;
  }

  is_game_over(): boolean {
    return this.over;
  }

  make_move(pos: number): boolean {
    if (this.over || pos < 0 || pos >= 64) return false;
    const flips = getFlips(this.board, pos, this.turn);
    if (flips.length === 0) return false;

    this.board[pos] = this.turn;
    for (const f of flips) this.board[f] = this.turn;
    this.advanceTurn();
    return true;
  }

  ai_move(depth: number): number {
    if (this.over) return -1;
    depth = Math.min(8, Math.max(1, depth));
    const pos = bestMove(this.board, this.turn, depth);
    if (pos < 0) return -1;

    const flips = getFlips(this.board, pos, this.turn);
    this.board[pos] = this.turn;
    for (const f of flips) this.board[f] = this.turn;
    this.advanceTurn();
    return pos;
  }

  black_count(): number {
    return countDiscs(this.board, 1);
  }

  white_count(): number {
    return countDiscs(this.board, 2);
  }

  reset(): void {
    this.board = initialBoard();
    this.turn = 1;
    this.over = false;
  }

  free(): void {
    // no-op — no WASM memory to release
  }

  private advanceTurn(): void {
    const next = 3 - this.turn;
    if (hasMoves(this.board, next)) {
      this.turn = next;
    } else if (hasMoves(this.board, this.turn)) {
      // opponent passes, current player goes again
    } else {
      this.over = true;
    }
  }
}
