# Reversi Ultra

**A high-performance Reversi (Othello) game engine built in Rust, compiled to WebAssembly, with a React canvas frontend.**

> Bitboard engine · Minimax + α-β pruning · Phase-aware evaluation · Flip animations · One-click play

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Rust Engine Deep Dive](#rust-engine-deep-dive)
- [Frontend Deep Dive](#frontend-deep-dive)
- [Getting Started](#getting-started)
- [Build Commands](#build-commands)
- [Test Results](#test-results)
- [Performance](#performance)
- [Design Decisions](#design-decisions)
- [Known Issues / In Progress](#known-issues--in-progress)

---

## Overview

Reversi Ultra is a complete Reversi (Othello) implementation featuring:

- **Rust/WASM game engine** — bitboard representation using two `u64` values (16 bytes total board state)
- **Parallel bitboard move generation** — legal moves computed in ~48 bitwise operations instead of iterating all 64 squares
- **Minimax AI with alpha-beta pruning** — move ordering (corners first), phase-aware evaluation, difficulty 1–10
- **React canvas renderer** — disc flip animations, drop-in effects, legal move indicators, last-move highlighting
- **Lobby → Playing → GameOver** state machine with vs AI and local PvP modes

---

## Architecture

```
┌──────────────────────────────────────────────┐
│                  Browser                      │
│                                               │
│  ┌─────────────┐   WASM FFI   ┌────────────┐│
│  │  React App   │◄────────────►│ Rust Engine ││
│  │              │              │             ││
│  │ useReversi   │  get_board() │ Board (u64) ││
│  │ Engine.ts    │  make_move() │ legal_moves ││
│  │              │  ai_move()   │ minimax+α-β ││
│  │ ReversiBoard │  get_legal   │ evaluate()  ││
│  │ .tsx (canvas)│  _moves()    │             ││
│  └─────────────┘              └────────────┘│
│                                               │
│  Vite + vite-plugin-wasm                      │
│  COOP/COEP headers for WASM isolation         │
└──────────────────────────────────────────────┘
```

**Two-layer separation:**
- **Engine layer** (Rust → WASM): All game rules, move validation, AI search. Zero allocations in hot paths.
- **Presentation layer** (React + Canvas): Rendering, animations, user interaction. No game logic.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Engine | Rust → WebAssembly | Bitwise operations, zero-cost abstractions, `opt-level = 3` + LTO |
| WASM Toolchain | wasm-pack + wasm-bindgen | Standard Rust→WASM pipeline, generates TypeScript types |
| Frontend | React 19 + TypeScript 5.9 | Type safety, hooks-based state management |
| Canvas | HTML5 Canvas API | Direct pixel control for disc animations (flip, drop-in) |
| Bundler | Vite 8 + vite-plugin-wasm | Fast HMR, native WASM module support |
| Styling | CSS custom properties | Centralized theming via `global.css` variables |

---

## Project Structure

```
reversi-ultra/
├── reversi-engine/               # Rust crate (WASM target)
│   ├── Cargo.toml                # opt-level=3, LTO enabled
│   ├── src/
│   │   ├── lib.rs                # WASM bindings — Game struct exposed to JS
│   │   ├── board.rs              # Board type (2×u64), move gen, apply_move
│   │   ├── ai.rs                 # Minimax + α-β, move ordering, phase eval
│   │   └── utils.rs              # Bitboard primitives (set/has/clear/iter/pop)
│   └── pkg/                      # wasm-pack output (auto-generated)
│       ├── reversi_engine.js     # JS glue code
│       ├── reversi_engine.d.ts   # TypeScript declarations
│       └── reversi_engine_bg.wasm # Compiled WASM binary (~20KB)
├── src/
│   ├── main.tsx                  # React mount point
│   ├── App.tsx                   # Lobby → Playing → GameOver shell
│   ├── useReversiEngine.ts       # WASM init + game state hook
│   ├── ReversiBoard.tsx          # Canvas renderer with animations
│   └── styles/
│       └── global.css            # CSS variables, layout, components
├── vite.config.ts                # WASM plugin, COOP/COEP headers
├── index.html                    # Entry HTML
└── package.json                  # Scripts: dev, build, lint, preview
```

---

## Rust Engine Deep Dive

### Board Representation

The board uses a **bitboard** representation — two `u64` integers where each bit represents a cell:

```rust
pub struct Board {
    pub black: u64,  // bit i = black disc at position i
    pub white: u64,  // bit i = white disc at position i
}
```

Cell position mapping: `pos = row * 8 + col` (0–63). The entire board state is **16 bytes** — trivially copyable, no heap allocation.

### Parallel Bitboard Move Generation

Instead of iterating all 64 squares and checking 8 directions for each (O(n²)), we use the **Dumb7Fill** algorithm that propagates through opponent pieces in parallel using bitwise shifts:

```rust
// Example: North direction (shift >> 8)
let mut candidates = opp & (mine >> 8);
candidates |= opp & (candidates >> 8);  // propagate through chains
candidates |= opp & (candidates >> 8);
candidates |= opp & (candidates >> 8);
candidates |= opp & (candidates >> 8);
candidates |= opp & (candidates >> 8);
moves |= empty & (candidates >> 8);     // landing squares
```

This runs for all 8 directions = **~48 bitwise operations total**, regardless of board state.

Edge wrapping is prevented with column masks:
- `NOT_A = 0xFEFEFEFEFEFEFEFE` — excludes column 0
- `NOT_H = 0x7F7F7F7F7F7F7F7F` — excludes column 7

### AI: Minimax with Alpha-Beta Pruning

**Search:**
- Minimax tree search with α-β cutoffs
- Depth mapped from difficulty 1–10 → engine depth 1–8
- **Move ordering** for better pruning: corners first → positional weight → flip count tiebreaker
- Insertion sort on ≤30 moves (cache-friendly, no allocation)

**Evaluation function (phase-aware):**

```
Phase = (total_discs - 4) / 56   // 0.0 = opening, 1.0 = endgame

Score = corner_diff × 100
      + danger_square_penalty     // X/C squares penalized only if adjacent corner is empty
      + positional_weights × (1 - phase)
      + mobility_diff × 10 × (0.3 + 0.7 × (1 - phase))
      + disc_count_diff × phase × 3
      + parity × phase × 15
```

| Component | Opening Weight | Endgame Weight | Purpose |
|-----------|---------------|----------------|---------|
| Corners | Always 100 | Always 100 | Permanent advantage |
| X/C-square penalty | -50/-20 if corner open | Ignored if corner taken | Avoid giving corners away |
| Positional weights | Full | Fades to 0 | Board control |
| Mobility | High (~10×) | Reduced (~3×) | Restrict opponent options |
| Disc count | 0 | High (3×) | Final score matters |
| Parity | 0 | 15× | Last-move advantage per region |

### Tests

```
12 tests covering:
├── utils: set/clear/has bit, popcount, iter_bits
├── board: initial state, legal moves, apply_move, game_over
└── ai: evaluate balance, best_move exists, no-moves handling,
        corner priority, phase detection
```

---

## Frontend Deep Dive

### State Machine

```
 ┌───────┐  startGame()  ┌─────────┐  game_over  ┌──────────┐
 │ Lobby ├──────────────►│ Playing ├────────────►│ GameOver │
 └───────┘               └────┬────┘             └────┬─────┘
      ▲                       │                        │
      └───────────────────────┴──── newGame() ─────────┘
```

### WASM Integration (`useReversiEngine.ts`)

Custom React hook that:
1. Calls `init()` to load WASM module
2. Creates a `Game` instance (Rust struct exposed via wasm-bindgen)
3. Reads board state, legal moves, scores via FFI calls
4. Computes flipped discs by diffing board state before/after moves
5. Triggers AI moves via `setTimeout` to allow one render frame

### Canvas Renderer (`ReversiBoard.tsx`)

- **DPR-aware**: Scales canvas for Retina/HiDPI displays
- **Board**: Green felt (#2d8a4e) with grid lines and 4 guide dots
- **Discs**: Radial gradient (subtle 3D effect) with drop shadow
- **Flip animation**: `scaleX` squeeze — disc compresses to 0 width, color switches at midpoint, expands back. Staggered across multiple flips for a cascade effect.
- **Drop-in animation**: New disc scales from 0 to 1
- **Last-move highlight**: Yellow overlay on the most recent move
- **Legal move indicators**: Semi-transparent white dots

### CSS Architecture

All theming via CSS custom properties in `global.css`:
```css
--bg: #0a0a0f;           /* App background */
--board-bg: #2d8a4e;     /* Board felt */
--accent: #7c6af7;       /* Buttons, highlights */
--black-disc: #1a1a1a;   /* Disc colors */
--white-disc: #f0ead6;
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **Rust** (via [rustup](https://rustup.rs/))
- **wasm-pack** (`cargo install wasm-pack`)
- **wasm32 target** (`rustup target add wasm32-unknown-unknown`)

### Install & Run

```bash
# Clone
git clone https://github.com/beautifulplanet/Reversi-Ultra.git
cd Reversi-Ultra/reversi-ultra

# Install JS dependencies
npm install

# Build the Rust engine to WASM
cd reversi-engine
wasm-pack build --target web --release
cd ..

# Start dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Build Commands

| Command | Location | What it does |
|---------|----------|-------------|
| `cargo test` | `reversi-engine/` | Run all 12 Rust engine tests |
| `cargo check` | `reversi-engine/` | Fast compile check without building |
| `wasm-pack build --target web --release` | `reversi-engine/` | Build WASM binary with opt-level=3 + LTO |
| `npm run dev` | `reversi-ultra/` | Start Vite dev server with HMR |
| `npm run build` | `reversi-ultra/` | Production build (TypeScript check + Vite bundle) |
| `npm run preview` | `reversi-ultra/` | Preview production build locally |
| `npm run lint` | `reversi-ultra/` | ESLint check |

---

## Test Results

```
$ cargo test
running 12 tests
test ai::tests::test_best_move_no_moves       ... ok
test ai::tests::test_best_move_exists          ... ok
test ai::tests::test_evaluate_initial          ... ok
test ai::tests::test_corner_priority           ... ok
test ai::tests::test_phase_detection           ... ok
test board::tests::test_initial_board          ... ok
test board::tests::test_legal_moves_opening    ... ok
test board::tests::test_apply_move_flips       ... ok
test board::tests::test_game_not_over_at_start ... ok
test utils::tests::test_set_clear_has          ... ok
test utils::tests::test_popcount               ... ok
test utils::tests::test_iter_bits              ... ok

test result: ok. 12 passed; 0 failed; 0 ignored
```

WASM binary size: **~20KB** (budget was 100KB).

---

## Performance

### Why Bitboards?

| Approach | Board Copy | Legal Moves | Memory |
|----------|-----------|-------------|--------|
| 2D array `[8][8]` | 64 bytes + indirection | O(64 × 8 × 7) = ~3,360 ops | 64+ bytes |
| `Vec<u8>` | Heap alloc + copy | O(n²) per call | 64+ bytes + heap |
| **Bitboard (2×u64)** | **16 bytes, trivial memcpy** | **~48 bitwise ops** | **16 bytes, stack only** |

### Optimizations Applied

1. **Parallel bitboard move generation** (Dumb7Fill) — ~70× faster than naive iteration
2. **`has_moves()` via `legal_moves() != 0`** — O(1) instead of iterating empty squares
3. **Move ordering** — corners → positional weight → flip count. Drastically improves α-β pruning
4. **Phase-aware evaluation** — opening focuses on mobility/position, endgame focuses on disc count/parity
5. **Conditional X/C-square penalties** — only penalized when adjacent corner is vacant
6. **Zero heap allocations in AI hot paths** — all data fits in stack-allocated arrays
7. **`opt-level = 3` + LTO** — maximum compiler optimization for WASM

### Lessons from Go Ultra

| Issue in Go Ultra | Reversi Ultra Solution |
|-------------------|----------------------|
| `neighbors()` heap-allocates Vec every call | Bitboard shifts only — no Vec in hot paths |
| `get_legal_moves()` is O(n²) per call | Parallel bitboard: O(48) bitwise ops |
| `Board.clone()` copies 17KB neighbor_masks | Board is 2×u64 = 16 bytes, trivial Copy |
| `opt-level = "z"` (size over speed) | `opt-level = 3` (speed, LTO) |
| Precomputed `neighbor_masks` never used | No precomputation needed — bitboard shifts |
| `Vec::contains()` for legal move lookup | Bitboard: `bit & mask != 0` is O(1) |
| AI on main thread freezes UI | setTimeout for render frame (Web Worker planned) |

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Rust + WASM over pure TypeScript | Bitwise ops in WASM are native-speed; TS bitwise is limited to 32-bit signed integers |
| Two `u64` over `[u128; 3]` | 8×8 board fits perfectly in u64; simpler, faster, no array indexing |
| Canvas over DOM/SVG | Direct pixel control for flip animations, single draw call, DPR-aware |
| Minimax over MCTS | Reversi has lower branching factor (~10) than Go (~250); minimax + α-β is optimal |
| CSS variables over CSS-in-JS | No runtime cost, works with canvas, theme-ready |
| Staggered flip animation | Visual feedback that conveys causality — you see the chain reaction |

---

## Known Issues / In Progress

See [GitHub Issues](https://github.com/beautifulplanet/Reversi-Ultra/issues) for the active tracker.

**Currently in progress:**
- AI thinking speed at higher difficulties — move ordering + bitboard movegen help significantly, but depth 7–8 search can still cause UI pauses. Web Worker offloading is the planned fix.

---

## Security

- No user input beyond mouse clicks on a canvas grid
- No network calls, no auth, no localStorage
- No `eval()`, no `innerHTML`, no URL parsing
- COOP/COEP headers configured for WASM isolation
- Attack surface is effectively zero

---

## License

MIT
