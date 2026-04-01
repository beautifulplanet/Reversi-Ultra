use crate::utils::*;

/// Direction shifts for 8 directions on an 8x8 board
/// North, South, East, West, NE, NW, SE, SW
const DIRECTIONS: [(i8, i8); 8] = [
    (-1, 0), (1, 0), (0, 1), (0, -1),
    (-1, 1), (-1, -1), (1, 1), (1, -1),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Color {
    Black,
    White,
}

impl Color {
    pub fn opponent(self) -> Color {
        match self {
            Color::Black => Color::White,
            Color::White => Color::Black,
        }
    }
}

/// Bitboard representation: two u64s for black and white pieces
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Board {
    pub black: u64,
    pub white: u64,
}

impl Board {
    /// Standard Reversi starting position
    pub fn new() -> Self {
        let mut b = Board { black: 0, white: 0 };
        // Center 4 squares: d4=white, e4=black, d5=black, e5=white
        // Row 3 col 3 = pos 27, row 3 col 4 = pos 28
        // Row 4 col 3 = pos 35, row 4 col 4 = pos 36
        b.white = set_bit(b.white, 27); // d4
        b.black = set_bit(b.black, 28); // e4
        b.black = set_bit(b.black, 35); // d5
        b.white = set_bit(b.white, 36); // e5
        b
    }

    #[inline]
    pub fn board_for(&self, color: Color) -> u64 {
        match color {
            Color::Black => self.black,
            Color::White => self.white,
        }
    }

    #[inline]
    pub fn opponent_board(&self, color: Color) -> u64 {
        match color {
            Color::Black => self.white,
            Color::White => self.black,
        }
    }

    #[inline]
    pub fn is_occupied(&self, pos: u8) -> bool {
        has_bit(self.black | self.white, pos)
    }

    /// Compute flips in one direction from a given position for a given color
    fn flips_in_direction(&self, pos: u8, color: Color, dr: i8, dc: i8) -> u64 {
        let mine = self.board_for(color);
        let opp = self.opponent_board(color);
        let mut flips: u64 = 0;
        let mut r = (pos / 8) as i8 + dr;
        let mut c = (pos % 8) as i8 + dc;

        while r >= 0 && r < 8 && c >= 0 && c < 8 {
            let p = (r * 8 + c) as u8;
            if has_bit(opp, p) {
                flips = set_bit(flips, p);
            } else if has_bit(mine, p) {
                return flips; // anchored — these all flip
            } else {
                return 0; // empty square — no flip
            }
            r += dr;
            c += dc;
        }
        0 // ran off board — no flip
    }

    /// All discs that would be flipped if `color` plays at `pos`
    pub fn get_flips(&self, pos: u8, color: Color) -> u64 {
        if self.is_occupied(pos) {
            return 0;
        }
        let mut all_flips: u64 = 0;
        for &(dr, dc) in &DIRECTIONS {
            all_flips |= self.flips_in_direction(pos, color, dr, dc);
        }
        all_flips
    }

    /// Apply a move: place disc + flip captured discs
    pub fn apply_move(&self, pos: u8, color: Color) -> Board {
        let flips = self.get_flips(pos, color);
        let mut b = *self;
        let placed = set_bit(0, pos);
        match color {
            Color::Black => {
                b.black |= placed | flips;
                b.white &= !flips;
            }
            Color::White => {
                b.white |= placed | flips;
                b.black &= !flips;
            }
        }
        b
    }

    /// Parallel bitboard legal move generator — O(48) bitwise ops instead of O(empty×8×7)
    pub fn legal_moves(&self, color: Color) -> u64 {
        let mine = self.board_for(color);
        let opp = self.opponent_board(color);
        let empty = !(self.black | self.white);

        // Masks to prevent wraparound on left/right edges
        const NOT_A: u64 = 0xFEFEFEFEFEFEFEFE; // not column 0
        const NOT_H: u64 = 0x7F7F7F7F7F7F7F7F; // not column 7

        let mut moves: u64 = 0;

        // For each of 8 directions, propagate through opponent pieces to find legal destinations
        // Direction: North (shift >> 8)
        {
            let mut candidates = opp & (mine >> 8);
            candidates |= opp & (candidates >> 8);
            candidates |= opp & (candidates >> 8);
            candidates |= opp & (candidates >> 8);
            candidates |= opp & (candidates >> 8);
            candidates |= opp & (candidates >> 8);
            moves |= empty & (candidates >> 8);
        }
        // Direction: South (shift << 8)
        {
            let mut candidates = opp & (mine << 8);
            candidates |= opp & (candidates << 8);
            candidates |= opp & (candidates << 8);
            candidates |= opp & (candidates << 8);
            candidates |= opp & (candidates << 8);
            candidates |= opp & (candidates << 8);
            moves |= empty & (candidates << 8);
        }
        // Direction: East (shift << 1, mask NOT_A)
        {
            let masked_opp = opp & NOT_A;
            let mut candidates = masked_opp & (mine << 1);
            candidates |= masked_opp & (candidates << 1);
            candidates |= masked_opp & (candidates << 1);
            candidates |= masked_opp & (candidates << 1);
            candidates |= masked_opp & (candidates << 1);
            candidates |= masked_opp & (candidates << 1);
            moves |= empty & NOT_A & (candidates << 1);
        }
        // Direction: West (shift >> 1, mask NOT_H)
        {
            let masked_opp = opp & NOT_H;
            let mut candidates = masked_opp & (mine >> 1);
            candidates |= masked_opp & (candidates >> 1);
            candidates |= masked_opp & (candidates >> 1);
            candidates |= masked_opp & (candidates >> 1);
            candidates |= masked_opp & (candidates >> 1);
            candidates |= masked_opp & (candidates >> 1);
            moves |= empty & NOT_H & (candidates >> 1);
        }
        // Direction: NE (shift >> 7, mask NOT_A)
        {
            let masked_opp = opp & NOT_A;
            let mut candidates = masked_opp & (mine >> 7);
            candidates |= masked_opp & (candidates >> 7);
            candidates |= masked_opp & (candidates >> 7);
            candidates |= masked_opp & (candidates >> 7);
            candidates |= masked_opp & (candidates >> 7);
            candidates |= masked_opp & (candidates >> 7);
            moves |= empty & NOT_A & (candidates >> 7);
        }
        // Direction: NW (shift >> 9, mask NOT_H)
        {
            let masked_opp = opp & NOT_H;
            let mut candidates = masked_opp & (mine >> 9);
            candidates |= masked_opp & (candidates >> 9);
            candidates |= masked_opp & (candidates >> 9);
            candidates |= masked_opp & (candidates >> 9);
            candidates |= masked_opp & (candidates >> 9);
            candidates |= masked_opp & (candidates >> 9);
            moves |= empty & NOT_H & (candidates >> 9);
        }
        // Direction: SE (shift << 9, mask NOT_A)
        {
            let masked_opp = opp & NOT_A;
            let mut candidates = masked_opp & (mine << 9);
            candidates |= masked_opp & (candidates << 9);
            candidates |= masked_opp & (candidates << 9);
            candidates |= masked_opp & (candidates << 9);
            candidates |= masked_opp & (candidates << 9);
            candidates |= masked_opp & (candidates << 9);
            moves |= empty & NOT_A & (candidates << 9);
        }
        // Direction: SW (shift << 7, mask NOT_H)
        {
            let masked_opp = opp & NOT_H;
            let mut candidates = masked_opp & (mine << 7);
            candidates |= masked_opp & (candidates << 7);
            candidates |= masked_opp & (candidates << 7);
            candidates |= masked_opp & (candidates << 7);
            candidates |= masked_opp & (candidates << 7);
            candidates |= masked_opp & (candidates << 7);
            moves |= empty & NOT_H & (candidates << 7);
        }

        moves
    }

    /// Check if a color has any legal move — O(1) via bitboard movegen
    #[inline]
    pub fn has_moves(&self, color: Color) -> bool {
        self.legal_moves(color) != 0
    }

    /// Is the game over? (neither player can move)
    pub fn is_game_over(&self) -> bool {
        !self.has_moves(Color::Black) && !self.has_moves(Color::White)
    }

    /// Disc counts
    pub fn count(&self, color: Color) -> u32 {
        popcount(self.board_for(color))
    }

    /// Get the state of a cell: 0=empty, 1=black, 2=white
    pub fn cell_state(&self, pos: u8) -> u8 {
        if has_bit(self.black, pos) {
            1
        } else if has_bit(self.white, pos) {
            2
        } else {
            0
        }
    }

    /// Return board as a flat [u8; 64] for JS consumption
    pub fn to_array(&self) -> [u8; 64] {
        let mut arr = [0u8; 64];
        for i in 0..64 {
            arr[i] = self.cell_state(i as u8);
        }
        arr
    }
}

impl Default for Board {
    fn default() -> Self {
        Board::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_board() {
        let b = Board::new();
        assert_eq!(b.count(Color::Black), 2);
        assert_eq!(b.count(Color::White), 2);
        assert_eq!(b.cell_state(27), 2); // d4 = white
        assert_eq!(b.cell_state(28), 1); // e4 = black
        assert_eq!(b.cell_state(35), 1); // d5 = black
        assert_eq!(b.cell_state(36), 2); // e5 = white
    }

    #[test]
    fn test_legal_moves_opening() {
        let b = Board::new();
        let moves = b.legal_moves(Color::Black);
        // Black's opening moves: d3(19), c4(26), f5(37), e6(44)
        assert!(has_bit(moves, 19));
        assert!(has_bit(moves, 26));
        assert!(has_bit(moves, 37));
        assert!(has_bit(moves, 44));
        assert_eq!(popcount(moves), 4);
    }

    #[test]
    fn test_apply_move_flips() {
        let b = Board::new();
        // Black plays d3 (pos 19), should flip d4 (pos 27) from white to black
        let b2 = b.apply_move(19, Color::Black);
        assert_eq!(b2.cell_state(19), 1); // placed
        assert_eq!(b2.cell_state(27), 1); // flipped
        assert_eq!(b2.count(Color::Black), 4);
        assert_eq!(b2.count(Color::White), 1);
    }

    #[test]
    fn test_game_not_over_at_start() {
        let b = Board::new();
        assert!(!b.is_game_over());
    }
}
