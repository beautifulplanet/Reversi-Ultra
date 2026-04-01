/**
 * Simulates the EXACT useReversiEngine flow — without React.
 * Tests the same sequence of calls the UI makes:
 *   playMove → syncState → doAiMove → syncState → check state
 * 
 * If this test passes but the game freezes in the browser,
 * the bug is in React rendering / closure state.
 * 
 * Run with: npx tsx test-ui-flow.ts
 */
import { Game } from './src/engine';

let failures: string[] = [];

function simulateGameUI(gameNum: number, aiDepth: number): void {
  const game = new Game();
  let moveNum = 0;
  const maxCycles = 100;

  while (!game.is_game_over() && moveNum < maxCycles) {
    // ── Simulate what App.tsx computes ──
    const turn = game.current_turn();
    const isPlayerTurn = turn === 1; // mode === 'ai', so player is Black (1)
    const legalMoves = game.get_legal_moves();
    const isGameOver = game.is_game_over();
    const thinking = false; // not thinking between moves

    // Check: disabled = !isPlayerTurn || thinking || phase === 'gameover'
    const disabled = !isPlayerTurn || thinking || isGameOver;

    // Check: legalMoves passed to board = isPlayerTurn && !thinking ? legalMoves : []
    const boardLegalMoves = isPlayerTurn && !thinking ? legalMoves : [];

    if (disabled && !isGameOver) {
      // Board is disabled but game isn't over — stuck!
      // This should only happen if it's the AI's turn
      if (turn !== 2) {
        failures.push(`Game ${gameNum} move ${moveNum}: board disabled, !gameOver, turn=${turn} (should be 2 if disabled)`);
        return;
      }
    }

    if (!disabled && boardLegalMoves.length === 0 && !isGameOver) {
      failures.push(`Game ${gameNum} move ${moveNum}: board enabled but 0 legal moves shown, turn=${turn}`);
      return;
    }

    if (turn !== 1) {
      failures.push(`Game ${gameNum} move ${moveNum}: expected human turn (1), got ${turn}`);
      return;
    }

    if (legalMoves.length === 0) {
      failures.push(`Game ${gameNum} move ${moveNum}: human's turn but 0 legal moves`);
      return;
    }

    // ── Simulate playMove (human plays) ──
    const pos = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    const flips = game.get_flips(pos);
    const ok = game.make_move(pos);
    if (!ok) {
      failures.push(`Game ${gameNum} move ${moveNum}: make_move(${pos}) returned false`);
      return;
    }

    // ── Simulate syncState after human move ──
    const stateAfterHuman = {
      turn: game.current_turn(),
      legalMoves: game.get_legal_moves(),
      isGameOver: game.is_game_over(),
    };

    if (stateAfterHuman.isGameOver) break;

    // ── Simulate: if AI mode and turn === 2, call doAiMove ──
    if (stateAfterHuman.turn === 2) {
      // AI move loop (handles human-pass chaining)
      let aiLoops = 0;
      while (game.current_turn() === 2 && !game.is_game_over() && aiLoops < 30) {
        const boardBefore = game.get_board();
        const aiMove = game.ai_move(aiDepth);

        if (aiMove >= 0 && aiMove < 64) {
          // AI played a move
          const boardAfter = game.get_board();
          const aiFlipped: number[] = [];
          for (let i = 0; i < 64; i++) {
            if (i !== aiMove && boardBefore[i] !== boardAfter[i]) aiFlipped.push(i);
          }

          // syncState
          const stateAfterAI = {
            turn: game.current_turn(),
            legalMoves: game.get_legal_moves(),
            isGameOver: game.is_game_over(),
          };

          if (stateAfterAI.isGameOver) break;

          if (stateAfterAI.turn === 2) {
            // Human must pass — AI goes again (the setTimeout chain)
            aiLoops++;
            continue;
          }
          // Turn is now 1 (human) — check sanity
          if (stateAfterAI.legalMoves.length === 0) {
            failures.push(`Game ${gameNum} move ${moveNum}: after AI move, turn=1 but 0 legal moves`);
            return;
          }
        } else {
          // AI passed (returned -1, advanceTurn was called)
          const stateAfterPass = {
            turn: game.current_turn(),
            isGameOver: game.is_game_over(),
          };

          if (stateAfterPass.isGameOver) break;
          
          if (stateAfterPass.turn === 2) {
            // Still AI's turn after AI passed?! Bug!
            failures.push(`Game ${gameNum} move ${moveNum}: AI passed but turn still 2`);
            return;
          }
        }
        aiLoops++;
      }

      if (aiLoops >= 30) {
        failures.push(`Game ${gameNum} move ${moveNum}: AI loop ran 30 times without terminating`);
        return;
      }
    }

    // After the AI is done, verify the game is in a playable state for the human
    if (!game.is_game_over()) {
      const finalTurn = game.current_turn();
      const finalLegal = game.get_legal_moves();

      if (finalTurn !== 1) {
        failures.push(`Game ${gameNum} move ${moveNum}: after AI done, turn=${finalTurn} expected 1`);
        return;
      }

      if (finalLegal.length === 0) {
        // This would mean: it's human's turn, they have no moves, but game isn't over.
        // advanceTurn should have handled this.
        failures.push(`Game ${gameNum} move ${moveNum}: human's turn but 0 legal moves, game not over`);
        return;
      }

      // Simulate the disabled check that App.tsx would do
      const isPlayerTurnFinal = finalTurn === 1;
      const disabledFinal = !isPlayerTurnFinal || false || false; // thinking=false, not gameover
      if (disabledFinal) {
        failures.push(`Game ${gameNum} move ${moveNum}: board would be disabled after AI finishes`);
        return;
      }
    }

    moveNum++;
  }
}

// ── Run ──
console.log('Simulating 500 games with exact UI flow...\n');

const t0 = performance.now();
for (let i = 0; i < 200; i++) simulateGameUI(i + 1, 1);
console.log(`Depth 1: 200 games (${(performance.now() - t0).toFixed(0)}ms)`);

const t1 = performance.now();
for (let i = 0; i < 150; i++) simulateGameUI(200 + i + 1, 2);
console.log(`Depth 2: 150 games (${(performance.now() - t1).toFixed(0)}ms)`);

const t2 = performance.now();
for (let i = 0; i < 100; i++) simulateGameUI(350 + i + 1, 3);
console.log(`Depth 3: 100 games (${(performance.now() - t2).toFixed(0)}ms)`);

const t3 = performance.now();
for (let i = 0; i < 50; i++) simulateGameUI(450 + i + 1, 4);
console.log(`Depth 4: 50 games (${(performance.now() - t3).toFixed(0)}ms)`);

console.log('\n=== RESULTS ===');
console.log(`Failures: ${failures.length}`);

if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures.slice(0, 20)) console.log(`  ❌ ${f}`);
  if (failures.length > 20) console.log(`  ... and ${failures.length - 20} more`);
  process.exit(1);
} else {
  console.log('\n✅ ALL 500 UI FLOW SIMULATIONS PASSED');
  process.exit(0);
}
