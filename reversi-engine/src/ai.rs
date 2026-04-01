use crate::board::{Board, Color};
use crate::utils::*;

// ── Constants ──

const CORNERS: u64 = (1u64 << 0) | (1u64 << 7) | (1u64 << 56) | (1u64 << 63);

const X_SQUARES: [(u8, u8); 4] = [(9, 0), (14, 7), (49, 56), (54, 63)];
const C_SQUARES: [(u8, u8); 8] = [
    (1, 0), (8, 0),
    (6, 7), (15, 7),
    (48, 56), (57, 56),
    (55, 63), (62, 63),
];

const POSITION_WEIGHTS: [i32; 64] = [
    100, -20,  10,   5,   5,  10, -20, 100,
    -20, -50,  -2,  -2,  -2,  -2, -50, -20,
     10,  -2,   1,   0,   0,   1,  -2,  10,
      5,  -2,   0,   0,   0,   0,  -2,   5,
      5,  -2,   0,   0,   0,   0,  -2,   5,
     10,  -2,   1,   0,   0,   1,  -2,  10,
    -20, -50,  -2,  -2,  -2,  -2, -50, -20,
    100, -20,  10,   5,   5,  10, -20, 100,
];

// ── Zobrist Hashing ──

/// Precomputed Zobrist keys: [position][0=black, 1=white]
/// Deterministic seed so hash is reproducible across calls.
fn zobrist_keys() -> [[u64; 2]; 64] {
    let mut keys = [[0u64; 2]; 64];
    // Simple LCG PRNG with fixed seed (deterministic, no rand crate needed)
    let mut state: u64 = 0x12345678_9ABCDEF0;
    for pos in 0..64 {
        for color in 0..2 {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            keys[pos][color] = state;
        }
    }
    keys
}

/// Compute Zobrist hash for a board
fn zobrist_hash(board: &Board, keys: &[[u64; 2]; 64]) -> u64 {
    let mut h: u64 = 0;
    for pos in iter_bits(board.black) {
        h ^= keys[pos as usize][0];
    }
    for pos in iter_bits(board.white) {
        h ^= keys[pos as usize][1];
    }
    h
}

// ── Transposition Table ──

const TT_SIZE: usize = 1 << 14; // 16K entries ~300KB — fast to allocate, plenty for Reversi
const TT_MASK: usize = TT_SIZE - 1;

#[derive(Clone, Copy)]
struct TTEntry {
    hash: u64,
    depth: u8,
    score: i32,
    flag: u8,      // 0=exact, 1=lower_bound (alpha), 2=upper_bound (beta)
    best_move: u8, // best move found at this node (for move ordering)
}

const TT_EXACT: u8 = 0;
const TT_LOWER: u8 = 1;
const TT_UPPER: u8 = 2;

struct TranspositionTable {
    entries: Vec<TTEntry>,
    keys: [[u64; 2]; 64],
}

impl TranspositionTable {
    fn new() -> Self {
        TranspositionTable {
            entries: vec![TTEntry { hash: 0, depth: 0, score: 0, flag: 0, best_move: 255 }; TT_SIZE],
            keys: zobrist_keys(),
        }
    }

    fn probe(&self, hash: u64, depth: u8, alpha: i32, beta: i32) -> Option<(i32, u8)> {
        let idx = (hash as usize) & TT_MASK;
        let entry = &self.entries[idx];
        if entry.hash != hash || entry.depth < depth {
            return None; // miss or shallower search
        }
        match entry.flag {
            TT_EXACT => Some((entry.score, entry.best_move)),
            TT_LOWER if entry.score >= beta => Some((entry.score, entry.best_move)),
            TT_UPPER if entry.score <= alpha => Some((entry.score, entry.best_move)),
            _ => None,
        }
    }

    fn store(&mut self, hash: u64, depth: u8, score: i32, flag: u8, best_move: u8) {
        let idx = (hash as usize) & TT_MASK;
        let entry = &mut self.entries[idx];
        // Always replace if deeper or same hash
        if entry.hash != hash || depth >= entry.depth {
            *entry = TTEntry { hash, depth, score, flag, best_move };
        }
    }

    fn get_best_move(&self, hash: u64) -> Option<u8> {
        let idx = (hash as usize) & TT_MASK;
        let entry = &self.entries[idx];
        if entry.hash == hash && entry.best_move != 255 {
            Some(entry.best_move)
        } else {
            None
        }
    }

    fn hash(&self, board: &Board) -> u64 {
        zobrist_hash(board, &self.keys)
    }
}

// ── Evaluation ──

#[inline]
fn corner_count(board: u64) -> i32 {
    (board & CORNERS).count_ones() as i32
}

fn danger_square_penalty(board: u64, occupied_corners: u64) -> i32 {
    let mut penalty = 0i32;
    for &(sq, corner) in &X_SQUARES {
        if has_bit(board, sq) && !has_bit(occupied_corners, corner) {
            penalty += 50;
        }
    }
    for &(sq, corner) in &C_SQUARES {
        if has_bit(board, sq) && !has_bit(occupied_corners, corner) {
            penalty += 20;
        }
    }
    penalty
}

#[inline]
fn game_phase(board: &Board) -> f32 {
    let total = popcount(board.black | board.white) as f32;
    ((total - 4.0) / 56.0).clamp(0.0, 1.0)
}

/// Fast leaf evaluation — reuses precomputed moves for the current player,
/// only computes opponent mobility (1 legal_moves call instead of 2).
fn evaluate_with_mobility(board: &Board, color: Color, current_color: Color, current_moves: u64) -> i32 {
    let opp = color.opponent();
    // Reuse precomputed moves for whichever side we already know
    let (my_mobility, opp_mobility) = if current_color == color {
        (popcount(current_moves) as i32, popcount(board.legal_moves(opp)) as i32)
    } else {
        (popcount(board.legal_moves(color)) as i32, popcount(current_moves) as i32)
    };
    evaluate_inner(board, color, my_mobility, opp_mobility)
}

pub fn evaluate(board: &Board, color: Color) -> i32 {
    let opp = color.opponent();
    let my_mobility = popcount(board.legal_moves(color)) as i32;
    let opp_mobility = popcount(board.legal_moves(opp)) as i32;
    evaluate_inner(board, color, my_mobility, opp_mobility)
}

fn evaluate_inner(board: &Board, color: Color, my_mobility: i32, opp_mobility: i32) -> i32 {
    let opp = color.opponent();
    let my_board = board.board_for(color);
    let opp_board = board.opponent_board(color);
    let all_occupied = board.black | board.white;
    let phase = game_phase(board);

    let corner_diff = (corner_count(my_board) - corner_count(opp_board)) * 100;

    let occupied_corners = all_occupied & CORNERS;
    let my_danger = danger_square_penalty(my_board, occupied_corners);
    let opp_danger = danger_square_penalty(opp_board, occupied_corners);
    let danger_diff = opp_danger as i32 - my_danger as i32;

    let mut pos_score: i32 = 0;
    for p in iter_bits(my_board) {
        pos_score += POSITION_WEIGHTS[p as usize];
    }
    for p in iter_bits(opp_board) {
        pos_score -= POSITION_WEIGHTS[p as usize];
    }

    let mobility_diff = (my_mobility - opp_mobility) * 10;

    let my_count = popcount(my_board) as i32;
    let opp_count = popcount(opp_board) as i32;
    let disc_diff = my_count - opp_count;

    let empty_count = 64 - (my_count + opp_count);
    let parity = if empty_count % 2 == 0 { -1 } else { 1 };

    let early_weight = 1.0 - phase;
    let late_weight = phase;

    corner_diff
        + danger_diff
        + (pos_score as f32 * early_weight) as i32
        + (mobility_diff as f32 * (0.3 + 0.7 * early_weight)) as i32
        + (disc_diff as f32 * late_weight * 3.0) as i32
        + (parity as f32 * late_weight * 15.0) as i32
}

// ── Move Ordering ──

/// Order moves for better alpha-beta cutoffs.
/// TT best move goes first, then corners, then by positional weight.
fn ordered_moves(_board: &Board, moves: u64, _color: Color, tt_best: Option<u8>) -> [u8; 64] {
    let mut move_list: [(i32, u8); 64] = [(0, 0); 64];
    let mut count = 0usize;

    for pos in iter_bits(moves) {
        let priority = if tt_best == Some(pos) {
            20000 // TT best move always first
        } else if has_bit(CORNERS, pos) {
            10000
        } else {
            POSITION_WEIGHTS[pos as usize]
        };
        move_list[count] = (priority, pos);
        count += 1;
    }

    // Insertion sort (max ~30 moves)
    for i in 1..count {
        let key = move_list[i];
        let mut j = i;
        while j > 0 && move_list[j - 1].0 < key.0 {
            move_list[j] = move_list[j - 1];
            j -= 1;
        }
        move_list[j] = key;
    }

    let mut result = [255u8; 64];
    for i in 0..count {
        result[i] = move_list[i].1;
    }
    result
}

// ── Minimax with Alpha-Beta + TT ──

fn minimax(
    board: &Board,
    depth: u8,
    mut alpha: i32,
    mut beta: i32,
    maximizing: bool,
    ai_color: Color,
    tt: &mut TranspositionTable,
    nodes: &mut u32,
) -> i32 {
    *nodes += 1;
    let current_color = if maximizing { ai_color } else { ai_color.opponent() };

    // Compute legal moves ONCE — replaces the redundant is_game_over() + legal_moves() pair
    let moves = board.legal_moves(current_color);

    // Leaf node — evaluate with precomputed mobility (avoids recomputing legal_moves)
    if depth == 0 {
        return evaluate_with_mobility(board, ai_color, current_color, moves);
    }

    if moves == 0 {
        // Current player must pass — check if opponent can move
        if !board.has_moves(current_color.opponent()) {
            // Neither player can move — game over
            return evaluate(board, ai_color);
        }
        // Pass turn (don't decrement depth — passing isn't a real move)
        return minimax(board, depth, alpha, beta, !maximizing, ai_color, tt, nodes);
    }

    let hash = tt.hash(board);

    // TT probe
    if let Some((score, _)) = tt.probe(hash, depth, alpha, beta) {
        return score;
    }

    let tt_best = tt.get_best_move(hash);
    let sorted = ordered_moves(board, moves, current_color, tt_best);

    let mut best_move_in_node: u8 = 255;

    // Save original bounds BEFORE mutation — critical for correct TT flag computation
    let orig_alpha = alpha;
    let orig_beta = beta;

    if maximizing {
        let mut max_eval = i32::MIN;
        for &pos in &sorted {
            if pos == 255 { break; }
            let new_board = board.apply_move(pos, current_color);
            let eval = minimax(&new_board, depth - 1, alpha, beta, false, ai_color, tt, nodes);
            if eval > max_eval {
                max_eval = eval;
                best_move_in_node = pos;
            }
            alpha = alpha.max(eval);
            if beta <= alpha { break; }
        }
        let flag = if max_eval <= orig_alpha { TT_UPPER } else if max_eval >= beta { TT_LOWER } else { TT_EXACT };
        tt.store(hash, depth, max_eval, flag, best_move_in_node);
        max_eval
    } else {
        let mut min_eval = i32::MAX;
        for &pos in &sorted {
            if pos == 255 { break; }
            let new_board = board.apply_move(pos, current_color);
            let eval = minimax(&new_board, depth - 1, alpha, beta, true, ai_color, tt, nodes);
            if eval < min_eval {
                min_eval = eval;
                best_move_in_node = pos;
            }
            beta = beta.min(eval);
            if beta <= alpha { break; }
        }
        let flag = if min_eval >= orig_beta { TT_LOWER } else if min_eval <= alpha { TT_UPPER } else { TT_EXACT };
        tt.store(hash, depth, min_eval, flag, best_move_in_node);
        min_eval
    }
}

// ── Public API: Iterative Deepening ──

/// Find the best move using iterative deepening up to `max_depth`.
/// Each depth builds on the TT from the previous, giving better move ordering.
pub fn best_move(board: &Board, color: Color, max_depth: u8) -> Option<u8> {
    let moves = board.legal_moves(color);
    if moves == 0 {
        return None;
    }

    // Only one legal move — return immediately
    if moves & (moves - 1) == 0 {
        return Some(moves.trailing_zeros() as u8);
    }

    let mut tt = TranspositionTable::new();
    let mut best_pos: Option<u8> = None;

    // Iterative deepening: depth 1, 2, ..., max_depth
    for depth in 1..=max_depth {
        let tt_best = best_pos; // use previous iteration's best as move ordering hint
        let sorted = ordered_moves(board, moves, color, tt_best);
        let mut current_best: Option<u8> = None;
        let mut current_best_score = i32::MIN;
        let mut nodes: u32 = 0;

        for &pos in &sorted {
            if pos == 255 { break; }
            let new_board = board.apply_move(pos, color);
            let score = minimax(&new_board, depth - 1, i32::MIN, i32::MAX, false, color, &mut tt, &mut nodes);
            if score > current_best_score {
                current_best_score = score;
                current_best = Some(pos);
            }
        }

        if current_best.is_some() {
            best_pos = current_best;
        }
    }

    best_pos
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evaluate_initial() {
        let b = Board::new();
        let score = evaluate(&b, Color::Black);
        assert!(score.abs() < 20, "Initial board should be roughly balanced, got {}", score);
    }

    #[test]
    fn test_best_move_exists() {
        let b = Board::new();
        let mv = best_move(&b, Color::Black, 3);
        assert!(mv.is_some());
        let pos = mv.unwrap();
        assert!(pos == 19 || pos == 26 || pos == 37 || pos == 44);
    }

    #[test]
    fn test_best_move_no_moves() {
        let b = Board { black: 0, white: 0 };
        let mv = best_move(&b, Color::Black, 3);
        assert!(mv.is_none());
    }

    #[test]
    fn test_corner_priority() {
        let b = Board {
            black: (1u64 << 1) | (1u64 << 9),
            white: 0,
        };
        let moves = CORNERS & 0x01;
        if moves != 0 {
            let sorted = ordered_moves(&b, moves, Color::Black, None);
            assert_eq!(sorted[0], 0);
        }
    }

    #[test]
    fn test_phase_detection() {
        let b = Board::new();
        let phase = game_phase(&b);
        assert!(phase < 0.05, "Opening should be near 0, got {}", phase);

        let full = Board { black: 0xFFFFFFFF00000000, white: 0x00000000FFFFFFFF };
        let phase = game_phase(&full);
        assert!((phase - 1.0).abs() < 0.02, "Full board should be near 1.0, got {}", phase);
    }

    #[test]
    fn test_iterative_deepening_returns_move() {
        let b = Board::new();
        // Depth 6 should still return a valid move quickly with TT
        let mv = best_move(&b, Color::Black, 6);
        assert!(mv.is_some());
        let pos = mv.unwrap();
        assert!(pos < 64);
        // Must be a legal move
        assert!(has_bit(b.legal_moves(Color::Black), pos));
    }

    #[test]
    fn test_single_move_instant() {
        // If only one legal move, should return instantly without searching
        // Create a board where black has exactly one move
        let mut b = Board { black: 0, white: 0 };
        // Put black at e4, white at d4 — black can only play at c4 (pos 26 direction)
        b.black = set_bit(0, 28); // e4
        b.white = set_bit(0, 27); // d4
        let moves = b.legal_moves(Color::Black);
        let move_count = popcount(moves);
        if move_count == 1 {
            let mv = best_move(&b, Color::Black, 8);
            assert!(mv.is_some());
        }
    }

    #[test]
    fn test_zobrist_deterministic() {
        let keys = zobrist_keys();
        let keys2 = zobrist_keys();
        // Same seed → same keys
        for i in 0..64 {
            assert_eq!(keys[i][0], keys2[i][0]);
            assert_eq!(keys[i][1], keys2[i][1]);
        }
    }

    #[test]
    fn test_tt_store_probe() {
        let mut tt = TranspositionTable::new();
        let b = Board::new();
        let hash = tt.hash(&b);
        tt.store(hash, 5, 42, TT_EXACT, 19);
        let result = tt.probe(hash, 5, i32::MIN, i32::MAX);
        assert!(result.is_some());
        let (score, best) = result.unwrap();
        assert_eq!(score, 42);
        assert_eq!(best, 19);
    }
}
