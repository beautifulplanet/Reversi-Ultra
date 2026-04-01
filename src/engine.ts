/**
 * Pure TypeScript Reversi engine — zero-allocation hot path.
 * Same API as the WASM Game class — drop-in replacement.
 */

// 8 directions as flat pairs: [dr, dc, dr, dc, ...]
const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

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
const X_SQ = [9, 14, 49, 54];
const X_CORNER = [0, 7, 56, 63];
const C_SQ = [1, 8, 6, 15, 48, 57, 55, 62];
const C_CORNER = [0, 0, 7, 7, 56, 56, 63, 63];

// ── Zero-allocation core ──

/** Check if placing `color` at `pos` flips anything. No allocation. */
function hasFlips(board: number[], pos: number, color: number): boolean {
  if (board[pos] !== 0) return false;
  const opp = 3 - color;
  const r0 = pos >> 3;
  const c0 = pos & 7;
  for (let d = 0; d < 8; d++) {
    const dr = DR[d], dc = DC[d];
    let r = r0 + dr, c = c0 + dc;
    let count = 0;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[(r << 3) | c] === opp) {
      count++;
      r += dr;
      c += dc;
    }
    if (count > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && board[(r << 3) | c] === color) {
      return true;
    }
  }
  return false;
}

/** Apply move in-place on board. No temporary arrays. */
function applyMoveInPlace(board: number[], pos: number, color: number): void {
  const opp = 3 - color;
  const r0 = pos >> 3;
  const c0 = pos & 7;
  board[pos] = color;
  for (let d = 0; d < 8; d++) {
    const dr = DR[d], dc = DC[d];
    let r = r0 + dr, c = c0 + dc;
    let count = 0;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[(r << 3) | c] === opp) {
      count++;
      r += dr;
      c += dc;
    }
    if (count > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && board[(r << 3) | c] === color) {
      // Walk back and flip
      r = r0 + dr;
      c = c0 + dc;
      for (let i = 0; i < count; i++) {
        board[(r << 3) | c] = color;
        r += dr;
        c += dc;
      }
    }
  }
}

/** Get flipped positions (only used for UI animation — not in AI hot path). */
function getFlips(board: number[], pos: number, color: number): number[] {
  if (board[pos] !== 0) return [];
  const opp = 3 - color;
  const r0 = pos >> 3;
  const c0 = pos & 7;
  const flips: number[] = [];
  for (let d = 0; d < 8; d++) {
    const dr = DR[d], dc = DC[d];
    let r = r0 + dr, c = c0 + dc;
    const start = flips.length;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[(r << 3) | c] === opp) {
      flips.push((r << 3) | c);
      r += dr;
      c += dc;
    }
    if (flips.length === start || r < 0 || r >= 8 || c < 0 || c >= 8 || board[(r << 3) | c] !== color) {
      flips.length = start; // undo — no valid bracket
    }
  }
  return flips;
}

function hasMoves(board: number[], color: number): boolean {
  for (let i = 0; i < 64; i++) {
    if (hasFlips(board, i, color)) return true;
  }
  return false;
}

function getLegalMoves(board: number[], color: number): number[] {
  const moves: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (hasFlips(board, i, color)) moves.push(i);
  }
  return moves;
}

// Pre-allocated move buffers per depth level (avoids array creation in minimax)
const _moveBufs: Int8Array[] = [];
const _moveCounts: number[] = [];
for (let d = 0; d < 20; d++) {
  _moveBufs.push(new Int8Array(64));
  _moveCounts.push(0);
}

/** Fill pre-allocated buffer with legal moves. Zero allocation. */
function fillMoves(board: number[], color: number, depth: number): number {
  const buf = _moveBufs[depth];
  let n = 0;
  // Corners first (move ordering built into the scan)
  for (const c of CORNERS) {
    if (hasFlips(board, c, color)) buf[n++] = c;
  }
  // Edges (non-corner)
  for (let i = 0; i < 64; i++) {
    const r = i >> 3, c = i & 7;
    if ((r === 0 || r === 7 || c === 0 || c === 7) && board[i] === 0) {
      if (i !== 0 && i !== 7 && i !== 56 && i !== 63) {
        if (hasFlips(board, i, color)) buf[n++] = i;
      }
    }
  }
  // Interior (sorted by POS_WEIGHTS descending — high-value first)
  for (let i = 0; i < 64; i++) {
    const r = i >> 3, c = i & 7;
    if (r > 0 && r < 7 && c > 0 && c < 7 && board[i] === 0) {
      if (hasFlips(board, i, color)) buf[n++] = i;
    }
  }
  return n;
}

function countDiscs(board: number[], color: number): number {
  let c = 0;
  for (let i = 0; i < 64; i++) if (board[i] === color) c++;
  return c;
}

// ── Evaluation (no allocation) ──

function evaluate(board: number[], aiColor: number): number {
  const opp = 3 - aiColor;
  let myCount = 0, oppCount = 0;
  let posScore = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === aiColor) { myCount++; posScore += POS_WEIGHTS[i]; }
    else if (board[i] === opp) { oppCount++; posScore -= POS_WEIGHTS[i]; }
  }
  const total = myCount + oppCount;
  const phase = (total - 4) / 56; // 0..1
  const early = 1 - phase;
  const late = phase;

  let myCorners = 0, oppCorners = 0;
  for (const c of CORNERS) {
    if (board[c] === aiColor) myCorners++;
    else if (board[c] === opp) oppCorners++;
  }

  let myDanger = 0, oppDanger = 0;
  for (let i = 0; i < 4; i++) {
    if (board[X_CORNER[i]] === 0) {
      if (board[X_SQ[i]] === aiColor) myDanger += 50;
      else if (board[X_SQ[i]] === opp) oppDanger += 50;
    }
  }
  for (let i = 0; i < 8; i++) {
    if (board[C_CORNER[i]] === 0) {
      if (board[C_SQ[i]] === aiColor) myDanger += 20;
      else if (board[C_SQ[i]] === opp) oppDanger += 20;
    }
  }

  const empty = 64 - total;
  const parity = empty % 2 === 0 ? -1 : 1;

  return (myCorners - oppCorners) * 100
    + (oppDanger - myDanger)
    + (posScore * early) | 0
    + ((myCount - oppCount) * late * 3) | 0
    + (parity * late * 15) | 0;
}

// ── Minimax — zero allocation in the hot path ──

let _nodeCount = 0;
const MAX_NODES = 50000;
const _boardStack: number[][] = [];
for (let d = 0; d < 20; d++) _boardStack.push(new Array(64).fill(0));

function minimax(
  board: number[], depth: number, alpha: number, beta: number,
  maximizing: boolean, aiColor: number, ply: number
): number {
  _nodeCount++;
  if (_nodeCount > MAX_NODES || depth === 0) return evaluate(board, aiColor);

  const current = maximizing ? aiColor : 3 - aiColor;
  const moveCount = fillMoves(board, current, ply);

  if (moveCount === 0) {
    if (!hasMoves(board, 3 - current)) return evaluate(board, aiColor);
    return minimax(board, depth - 1, alpha, beta, !maximizing, aiColor, ply);
  }

  const buf = _moveBufs[ply];
  const child = _boardStack[ply];

  if (maximizing) {
    let best = -999999;
    for (let i = 0; i < moveCount; i++) {
      if (_nodeCount > MAX_NODES) break;
      const pos = buf[i];
      // Copy board into pre-allocated child buffer
      for (let j = 0; j < 64; j++) child[j] = board[j];
      applyMoveInPlace(child, pos, current);
      const val = minimax(child, depth - 1, alpha, beta, false, aiColor, ply + 1);
      if (val > best) best = val;
      if (val > alpha) alpha = val;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = 999999;
    for (let i = 0; i < moveCount; i++) {
      if (_nodeCount > MAX_NODES) break;
      const pos = buf[i];
      for (let j = 0; j < 64; j++) child[j] = board[j];
      applyMoveInPlace(child, pos, current);
      const val = minimax(child, depth - 1, alpha, beta, true, aiColor, ply + 1);
      if (val < best) best = val;
      if (val < beta) beta = val;
      if (beta <= alpha) break;
    }
    return best;
  }
}

function bestMove(board: number[], color: number, depthLimit: number): number {
  const moves = getLegalMoves(board, color);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0];

  // Sort: corners first, then by POS_WEIGHTS
  moves.sort((a, b) => POS_WEIGHTS[b] - POS_WEIGHTS[a]);

  let best = moves[0];
  let bestScore = -999999;
  let alpha = -999999;
  _nodeCount = 0;

  for (const pos of moves) {
    if (_nodeCount > MAX_NODES) break;
    const next = board.slice();
    applyMoveInPlace(next, pos, color);
    const score = minimax(next, depthLimit - 1, alpha, 999999, false, color, 1);
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
    if (score > alpha) alpha = score;
  }
  return best;
}

// ── Game class (same API as before) ──

function initialBoard(): number[] {
  const b = new Array(64).fill(0);
  b[27] = 2; b[28] = 1;
  b[35] = 1; b[36] = 2;
  return b;
}

export class Game {
  private board: number[];
  private turn: number;
  private over: boolean;

  constructor() {
    this.board = initialBoard();
    this.turn = 1;
    this.over = false;
  }

  get_board(): number[] { return this.board.slice(); }
  get_legal_moves(): number[] { return getLegalMoves(this.board, this.turn); }
  current_turn(): number { return this.turn; }
  is_game_over(): boolean { return this.over; }
  black_count(): number { return countDiscs(this.board, 1); }
  white_count(): number { return countDiscs(this.board, 2); }
  free(): void { /* no-op */ }

  make_move(pos: number): boolean {
    if (this.over || pos < 0 || pos >= 64) return false;
    if (!hasFlips(this.board, pos, this.turn)) return false;
    applyMoveInPlace(this.board, pos, this.turn);
    this.advanceTurn();
    return true;
  }

  /** Get flipped positions for the LAST move (call BEFORE make_move for animation). */
  get_flips(pos: number): number[] {
    return getFlips(this.board, pos, this.turn);
  }

  ai_move(depth: number): number {
    if (this.over) return -1;
    depth = Math.min(6, Math.max(1, depth));
    const pos = bestMove(this.board, this.turn, depth);
    if (pos < 0) {
      // AI must pass — advance turn
      this.advanceTurn();
      return -1;
    }
    applyMoveInPlace(this.board, pos, this.turn);
    this.advanceTurn();
    return pos;
  }

  reset(): void {
    this.board = initialBoard();
    this.turn = 1;
    this.over = false;
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
