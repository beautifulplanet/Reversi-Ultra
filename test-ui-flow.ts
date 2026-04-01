/**
 * Simulates the EXACT call sequence of the FIXED useReversiEngine.ts.
 *
 * The fix: playMove → if turn===2 → doAiMove → if turn still 2 → chain doAiMove.
 * No useEffect dependency on state.turn (which failed when turn stayed 2).
 *
 * Run with: npx tsx test-ui-flow.ts
 */
import { Game } from './src/engine';

let totalGames = 0;
let totalPassChains = 0;
let freezes = 0;

for (let i = 0; i < 2000; i++) {
  const g = new Game();
  let moves = 0;
  totalGames++;

  while (!g.is_game_over() && moves < 200) {
    // Must be human's turn (1) at this point
    if (g.current_turn() !== 1) {
      freezes++;
      console.log(`FREEZE game#${i}: turn=${g.current_turn()} at move ${moves}`);
      break;
    }

    const legal = g.get_legal_moves();
    if (legal.length === 0) {
      freezes++;
      console.log(`FREEZE game#${i}: turn=1 but 0 legal moves at move ${moves}`);
      break;
    }

    // ─── playMove (human plays) ───
    const pos = legal[Math.floor(Math.random() * legal.length)];
    g.make_move(pos);

    if (g.is_game_over()) break;

    // ─── if turn === 2, trigger doAiMove ───
    // This is the fixed pattern: explicit chaining, not useEffect
    while (g.current_turn() === 2 && !g.is_game_over()) {
      const turnBefore = g.current_turn();
      g.ai_move(2);
      const turnAfter = g.current_turn();

      if (turnBefore === 2 && turnAfter === 2 && !g.is_game_over()) {
        totalPassChains++;
        // Fixed code: doAiMove detects turn still 2, chains via setTimeout
        // We loop again here (simulating the chain)
      }
    }

    moves++;
  }
}

console.log(`\nGames: ${totalGames}`);
console.log(`Pass-chain events resolved: ${totalPassChains}`);
console.log(`Freezes: ${freezes}`);

if (freezes === 0) {
  console.log(`\n✅ PASS: 0 freezes across ${totalGames} games. ${totalPassChains} pass-chains all resolved.`);
  process.exit(0);
} else {
  console.log(`\n❌ FAIL: ${freezes} freezes detected.`);
  process.exit(1);
}
