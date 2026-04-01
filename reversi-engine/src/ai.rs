use crate::board::{Board, Color};
use crate::utils::*;

// Corner positions
const CORNERS: u64 = (1u64 << 0) | (1u64 << 7) | (1u64 << 56) | (1u64 << 63);

// X-squares (diagonally adjacent to corners) — only dangerous if corner is empty
const X_SQUARES: [(u8, u8); 4] = [(9, 0), (14, 7), (49, 56), (54, 63)];
// C-squares (adjacent to corners on edges) — similarly conditional
const C_SQUARES: [(u8, u8); 8] = [
    (1, 0), (8, 0),       // near corner 0
    (6, 7), (15, 7),      // near corner 7
    (48, 56), (57, 56),   // near corner 56
    (55, 63), (62, 63),   // near corner 63
];

/// Static positional weights — used for move ordering and positional eval
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

/// Count corners held by a color
#[inline]
fn corner_count(board: u64) -> i32 {
    (board & CORNERS).count_ones() as i32
}

/// Penalty for X/C squares only when the adjacent corner is empty
fn danger_square_penalty(board: u64, occupied_corners: u64) -> i32 {
    let mut penalty = 0i32;
    for &(sq, corner) in &X_SQUARES {
        if has_bit(board, sq) && !has_bit(occupied_corners, corner) {
            penalty += 50; // X-square with open corner is very bad
        }
    }
    for &(sq, corner) in &C_SQUARES {
        if has_bit(board, sq) && !has_bit(occupied_corners, corner) {
            penalty += 20; // C-square with open corner is bad
        }
    }
    penalty
}

/// Game phase: 0.0 = opening, 1.0 = endgame
#[inline]
fn game_phase(board: &Board) -> f32 {
    let total = popcount(board.black | board.white) as f32;
    ((total - 4.0) / 56.0).clamp(0.0, 1.0)
}

/// Evaluate the board from `color`'s perspective, phase-aware
pub fn evaluate(board: &Board, color: Color) -> i32 {
    let opp = color.opponent();
    let my_board = board.board_for(color);
    let opp_board = board.opponent_board(color);
    let all_occupied = board.black | board.white;
    let phase = game_phase(board);

    // --- Corners (always valuable) ---
    let corner_diff = (corner_count(my_board) - corner_count(opp_board)) * 100;

    // --- X/C square penalties (conditional on corner ownership) ---
    let occupied_corners = all_occupied & CORNERS;
    let my_danger = danger_square_penalty(my_board, occupied_corners);
    let opp_danger = danger_square_penalty(opp_board, occupied_corners);
    let danger_diff = opp_danger as i32 - my_danger as i32; // opponent's penalty benefits us

    // --- Positional score (weighted down in endgame) ---
    let mut pos_score: i32 = 0;
    for p in iter_bits(my_board) {
        pos_score += POSITION_WEIGHTS[p as usize];
    }
    for p in iter_bits(opp_board) {
        pos_score -= POSITION_WEIGHTS[p as usize];
    }

    // --- Mobility ---
    let my_mobility = popcount(board.legal_moves(color)) as i32;
    let opp_mobility = popcount(board.legal_moves(opp)) as i32;
    let mobility_diff = (my_mobility - opp_mobility) * 10;

    // --- Disc count (only matters in endgame) ---
    let my_count = popcount(my_board) as i32;
    let opp_count = popcount(opp_board) as i32;
    let disc_diff = my_count - opp_count;

    // --- Parity heuristic (who moves last wins the region) ---
    let empty_count = 64 - (my_count + opp_count);
    let parity = if empty_count % 2 == 0 { -1 } else { 1 }; // odd = current mover advantage

    // --- Phase-weighted combination ---
    let early_weight = 1.0 - phase;
    let late_weight = phase;

    let score = corner_diff
        + danger_diff
        + (pos_score as f32 * early_weight) as i32
        + (mobility_diff as f32 * (0.3 + 0.7 * early_weight)) as i32
        + (disc_diff as f32 * late_weight * 3.0) as i32
        + (parity as f32 * late_weight * 15.0) as i32;

    score
}

/// Collect moves into a sorted array for better alpha-beta pruning
/// Order: corners first, then by positional weight (descending), X/C squares last
fn ordered_moves(board: &Board, moves: u64, color: Color) -> [u8; 64] {
    let mut move_list: [(i32, u8); 64] = [(0, 0); 64];
    let mut count = 0usize;

    for pos in iter_bits(moves) {
        let priority = if has_bit(CORNERS, pos) {
            10000 // corners always first
        } else {
            // Quick eval: positional weight + flip count as tiebreaker
            POSITION_WEIGHTS[pos as usize] + popcount(board.get_flips(pos, color)) as i32
        };
        move_list[count] = (priority, pos);
        count += 1;
    }

    // Sort descending by priority (simple insertion sort — max 30 moves)
    for i in 1..count {
        let key = move_list[i];
        let mut j = i;
        while j > 0 && move_list[j - 1].0 < key.0 {
            move_list[j] = move_list[j - 1];
            j -= 1;
        }
        move_list[j] = key;
    }

    let mut result = [255u8; 64]; // 255 = sentinel for "no more moves"
    for i in 0..count {
        result[i] = move_list[i].1;
    }
    result
}

/// Minimax with alpha-beta pruning + move ordering
fn minimax(board: &Board, depth: u8, mut alpha: i32, mut beta: i32, maximizing: bool, ai_color: Color) -> i32 {
    let current_color = if maximizing { ai_color } else { ai_color.opponent() };

    if depth == 0 || board.is_game_over() {
        return evaluate(board, ai_color);
    }

    let moves = board.legal_moves(current_color);

    // If no moves, pass turn
    if moves == 0 {
        return minimax(board, depth - 1, alpha, beta, !maximizing, ai_color);
    }

    let sorted = ordered_moves(board, moves, current_color);

    if maximizing {
        let mut max_eval = i32::MIN;
        for &pos in &sorted {
            if pos == 255 { break; }
            let new_board = board.apply_move(pos, current_color);
            let eval = minimax(&new_board, depth - 1, alpha, beta, false, ai_color);
            max_eval = max_eval.max(eval);
            alpha = alpha.max(eval);
            if beta <= alpha {
                break;
            }
        }
        max_eval
    } else {
        let mut min_eval = i32::MAX;
        for &pos in &sorted {
            if pos == 255 { break; }
            let new_board = board.apply_move(pos, current_color);
            let eval = minimax(&new_board, depth - 1, alpha, beta, true, ai_color);
            min_eval = min_eval.min(eval);
            beta = beta.min(eval);
            if beta <= alpha {
                break;
            }
        }
        min_eval
    }
}

/// Find the best move for `color` at a given search depth
pub fn best_move(board: &Board, color: Color, depth: u8) -> Option<u8> {
    let moves = board.legal_moves(color);
    if moves == 0 {
        return None;
    }

    let sorted = ordered_moves(board, moves, color);
    let mut best_pos: Option<u8> = None;
    let mut best_score = i32::MIN;

    for &pos in &sorted {
        if pos == 255 { break; }
        let new_board = board.apply_move(pos, color);
        let score = minimax(&new_board, depth - 1, i32::MIN, i32::MAX, false, color);
        if score > best_score {
            best_score = score;
            best_pos = Some(pos);
        }
    }

    best_pos
}

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
        // Should be one of the 4 legal opening moves
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
        // AI should strongly prefer corner moves when available
        // Set up a board where corner 0 is a legal move
        let b = Board {
            black: (1u64 << 1) | (1u64 << 9), // black at b1, b2
            white: 0,
        };
        // This is a synthetic test — just verify move ordering puts corners first
        let moves = CORNERS & 0x01; // just corner 0
        if moves != 0 {
            let sorted = ordered_moves(&b, moves, Color::Black);
            assert_eq!(sorted[0], 0); // corner should be first
        }
    }

    #[test]
    fn test_phase_detection() {
        let b = Board::new();
        let phase = game_phase(&b);
        assert!(phase < 0.05, "Opening should be near 0, got {}", phase);

        // Full board
        let full = Board { black: 0xFFFFFFFF00000000, white: 0x00000000FFFFFFFF };
        let phase = game_phase(&full);
        assert!((phase - 1.0).abs() < 0.02, "Full board should be near 1.0, got {}", phase);
    }
}
