/**
 * Automated engine test — plays 200 full games, measures AI timing,
 * detects freezes, stuck states, and logic errors.
 * Run with: npx tsx test-engine.ts
 */
import { Game } from './src/engine';

let totalGames = 0;
let totalMoves = 0;
let maxAiTime = 0;
let failures: string[] = [];

function playFullGame(gameNum: number, aiDepth: number): void {
  const game = new Game();
  let moveCount = 0;
  const maxMoves = 200; // safety limit — Reversi can't go past ~60 real moves

  while (!game.is_game_over() && moveCount < maxMoves) {
    const turn = game.current_turn();
    const legal = game.get_legal_moves();
    const board = game.get_board();

    // Validate board state
    let bCount = 0, wCount = 0, eCount = 0;
    for (let i = 0; i < 64; i++) {
      if (board[i] === 1) bCount++;
      else if (board[i] === 2) wCount++;
      else if (board[i] === 0) eCount++;
      else failures.push(`Game ${gameNum} move ${moveCount}: invalid cell value ${board[i]} at pos ${i}`);
    }
    if (bCount + wCount + eCount !== 64) {
      failures.push(`Game ${gameNum} move ${moveCount}: cell count mismatch ${bCount}+${wCount}+${eCount}`);
      return;
    }

    if (legal.length === 0) {
      // Should not happen — if no legal moves, game should have advanced past this player
      failures.push(`Game ${gameNum} move ${moveCount}: turn=${turn} has 0 legal moves but game not over`);
      return;
    }

    if (turn === 2) {
      // AI's turn — time it
      const t0 = performance.now();
      const move = game.ai_move(aiDepth);
      const elapsed = performance.now() - t0;

      if (elapsed > maxAiTime) maxAiTime = elapsed;

      if (elapsed > 2000) {
        failures.push(`Game ${gameNum} move ${moveCount}: AI took ${elapsed.toFixed(0)}ms at depth ${aiDepth} (FREEZE)`);
      }

      if (move < 0) {
        // AI passed — this is handled inside ai_move via advanceTurn
        // Verify turn changed
        if (game.current_turn() === 2 && !game.is_game_over()) {
          failures.push(`Game ${gameNum} move ${moveCount}: AI passed but turn still White and game not over`);
          return;
        }
      } else if (move >= 64) {
        failures.push(`Game ${gameNum} move ${moveCount}: AI returned invalid move ${move}`);
        return;
      }
    } else {
      // Human's turn — play random legal move
      // First test get_flips (used for animation in real app)
      const randomMove = legal[Math.floor(Math.random() * legal.length)];
      const flips = game.get_flips(randomMove);

      // Verify flips are valid positions
      for (const f of flips) {
        if (f < 0 || f >= 64) {
          failures.push(`Game ${gameNum} move ${moveCount}: get_flips returned invalid pos ${f}`);
        }
      }

      const ok = game.make_move(randomMove);
      if (!ok) {
        failures.push(`Game ${gameNum} move ${moveCount}: make_move(${randomMove}) returned false for legal move`);
        return;
      }

      // After move, check turn advanced
      const newTurn = game.current_turn();
      if (newTurn === turn && !game.is_game_over()) {
        // Same player goes again (opponent passed) — this is valid
        // But verify opponent truly has no moves
        // We can't easily check this without engine internals, so just log it
      }
    }

    moveCount++;
    totalMoves++;
  }

  if (moveCount >= maxMoves && !game.is_game_over()) {
    failures.push(`Game ${gameNum}: hit ${maxMoves} move limit — infinite loop?`);
  }

  // Verify final state
  if (game.is_game_over()) {
    const b = game.black_count();
    const w = game.white_count();
    if (b + w === 0) {
      failures.push(`Game ${gameNum}: game over but 0 discs on board`);
    }
  }

  totalGames++;
}

// ── Run tests at various depths ──
console.log('Running 200 full games...\n');

const t0 = performance.now();

// 100 games at depth 1 (easiest)
for (let i = 0; i < 100; i++) {
  playFullGame(i + 1, 1);
}
console.log(`Depth 1: 100 games done (${(performance.now() - t0).toFixed(0)}ms)`);

const t1 = performance.now();
// 50 games at depth 2
for (let i = 0; i < 50; i++) {
  playFullGame(100 + i + 1, 2);
}
console.log(`Depth 2: 50 games done (${(performance.now() - t1).toFixed(0)}ms)`);

const t2 = performance.now();
// 30 games at depth 3
for (let i = 0; i < 30; i++) {
  playFullGame(150 + i + 1, 3);
}
console.log(`Depth 3: 30 games done (${(performance.now() - t2).toFixed(0)}ms)`);

const t3 = performance.now();
// 20 games at depth 4
for (let i = 0; i < 20; i++) {
  playFullGame(180 + i + 1, 4);
}
console.log(`Depth 4: 20 games done (${(performance.now() - t3).toFixed(0)}ms)`);

// ── Report ──
console.log('\n=== RESULTS ===');
console.log(`Games played: ${totalGames}`);
console.log(`Total moves: ${totalMoves}`);
console.log(`Max AI move time: ${maxAiTime.toFixed(1)}ms`);
console.log(`Failures: ${failures.length}`);

if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log(`  ❌ ${f}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ ALL TESTS PASSED');
  process.exit(0);
}
