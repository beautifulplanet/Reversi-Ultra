/// Set bit at position
#[inline]
pub fn set_bit(board: u64, pos: u8) -> u64 {
    board | (1u64 << pos)
}

/// Clear bit at position
#[inline]
pub fn clear_bit(board: u64, pos: u8) -> u64 {
    board & !(1u64 << pos)
}

/// Check if bit is set at position
#[inline]
pub fn has_bit(board: u64, pos: u8) -> bool {
    (board & (1u64 << pos)) != 0
}

/// Count set bits
#[inline]
pub fn popcount(board: u64) -> u32 {
    board.count_ones()
}

/// Iterate over set bits, yielding each position
pub fn iter_bits(mut board: u64) -> impl Iterator<Item = u8> {
    std::iter::from_fn(move || {
        if board == 0 {
            None
        } else {
            let pos = board.trailing_zeros() as u8;
            board &= board - 1; // clear lowest set bit
            Some(pos)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_clear_has() {
        let b = set_bit(0, 0);
        assert!(has_bit(b, 0));
        assert!(!has_bit(b, 1));
        let b = clear_bit(b, 0);
        assert!(!has_bit(b, 0));
    }

    #[test]
    fn test_popcount() {
        assert_eq!(popcount(0), 0);
        assert_eq!(popcount(0xFF), 8);
    }

    #[test]
    fn test_iter_bits() {
        let b = set_bit(set_bit(0, 3), 7);
        let positions: Vec<u8> = iter_bits(b).collect();
        assert_eq!(positions, vec![3, 7]);
    }
}
