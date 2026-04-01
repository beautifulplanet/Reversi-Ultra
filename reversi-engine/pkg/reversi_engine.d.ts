/* tslint:disable */
/* eslint-disable */

/**
 * Game state exposed to JavaScript
 */
export class Game {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get AI's best move at the given depth
     */
    ai_move(depth: number): number;
    /**
     * Get score for black
     */
    black_count(): number;
    /**
     * Current turn: 1=black, 2=white
     */
    current_turn(): number;
    /**
     * Get the board state as a flat array (0=empty, 1=black, 2=white)
     */
    get_board(): Uint8Array;
    /**
     * Get legal moves as a list of positions
     */
    get_legal_moves(): Uint8Array;
    /**
     * Is the game over?
     */
    is_game_over(): boolean;
    /**
     * Make a human move at the given position. Returns true if valid.
     */
    make_move(pos: number): boolean;
    /**
     * Create a new game
     */
    constructor();
    /**
     * Reset the game
     */
    reset(): void;
    /**
     * Get score for white
     */
    white_count(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_game_free: (a: number, b: number) => void;
    readonly game_ai_move: (a: number, b: number) => number;
    readonly game_black_count: (a: number) => number;
    readonly game_current_turn: (a: number) => number;
    readonly game_get_board: (a: number) => [number, number];
    readonly game_get_legal_moves: (a: number) => [number, number];
    readonly game_is_game_over: (a: number) => number;
    readonly game_make_move: (a: number, b: number) => number;
    readonly game_new: () => number;
    readonly game_reset: (a: number) => void;
    readonly game_white_count: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
