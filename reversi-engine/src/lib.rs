mod utils;
mod board;
mod ai;

use wasm_bindgen::prelude::*;
use board::{Board, Color};
use ai::best_move;

/// Game state exposed to JavaScript
#[wasm_bindgen]
pub struct Game {
    board: Board,
    current_turn: Color,
    game_over: bool,
}

#[wasm_bindgen]
impl Game {
    /// Create a new game
    #[wasm_bindgen(constructor)]
    pub fn new() -> Game {
        Game {
            board: Board::new(),
            current_turn: Color::Black,
            game_over: false,
        }
    }

    /// Get the board state as a flat array (0=empty, 1=black, 2=white)
    pub fn get_board(&self) -> Vec<u8> {
        self.board.to_array().to_vec()
    }

    /// Get legal moves as a list of positions
    pub fn get_legal_moves(&self) -> Vec<u8> {
        crate::utils::iter_bits(self.board.legal_moves(self.current_turn)).collect()
    }

    /// Current turn: 1=black, 2=white
    pub fn current_turn(&self) -> u8 {
        match self.current_turn {
            Color::Black => 1,
            Color::White => 2,
        }
    }

    /// Is the game over?
    pub fn is_game_over(&self) -> bool {
        self.game_over
    }

    /// Make a human move at the given position. Returns true if valid.
    pub fn make_move(&mut self, pos: u8) -> bool {
        if self.game_over || pos >= 64 {
            return false;
        }

        let flips = self.board.get_flips(pos, self.current_turn);
        if flips == 0 {
            return false; // illegal move
        }

        self.board = self.board.apply_move(pos, self.current_turn);
        self.advance_turn();
        true
    }

    /// Get AI's best move at the given depth
    pub fn ai_move(&mut self, depth: u8) -> i8 {
        if self.game_over {
            return -1;
        }

        let depth = depth.min(8).max(1); // clamp 1..8
        match best_move(&self.board, self.current_turn, depth) {
            Some(pos) => {
                self.board = self.board.apply_move(pos, self.current_turn);
                self.advance_turn();
                pos as i8
            }
            None => -1, // no move available (pass)
        }
    }

    /// Get score for black
    pub fn black_count(&self) -> u32 {
        self.board.count(Color::Black)
    }

    /// Get score for white
    pub fn white_count(&self) -> u32 {
        self.board.count(Color::White)
    }

    /// Reset the game
    pub fn reset(&mut self) {
        self.board = Board::new();
        self.current_turn = Color::Black;
        self.game_over = false;
    }
}

impl Game {
    fn advance_turn(&mut self) {
        let next = self.current_turn.opponent();
        if self.board.has_moves(next) {
            self.current_turn = next;
        } else if self.board.has_moves(self.current_turn) {
            // opponent passes, current player goes again
        } else {
            self.game_over = true;
        }
    }
}
