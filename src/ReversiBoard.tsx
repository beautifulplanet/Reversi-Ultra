import { useRef, useEffect, useCallback } from 'react';
import type { CellState } from './useReversiEngine';

interface Props {
  board: CellState[];
  legalMoves: number[];
  lastMove: number | null;
  flippedDiscs: number[];
  turn: 1 | 2;
  disabled: boolean;
  onCellClick: (pos: number) => void;
}

const BOARD_CELLS = 8;
const PADDING = 2;

export default function ReversiBoard({
  board, legalMoves, lastMove, flippedDiscs, turn, disabled, onCellClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const flipProgressRef = useRef<Map<number, { progress: number; fromColor: CellState }>>(new Map());
  const dropRef = useRef<{ pos: number; progress: number } | null>(null);

  const getCellSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    return (canvas.width / window.devicePixelRatio - PADDING * 2) / BOARD_CELLS;
  }, []);

  // Start flip animation when flippedDiscs changes
  useEffect(() => {
    if (flippedDiscs.length === 0) return;
    const map = new Map<number, { progress: number; fromColor: CellState }>();
    flippedDiscs.forEach((pos, i) => {
      // fromColor is the opposite of current board value (it just flipped)
      const current = board[pos];
      const from = current === 1 ? 2 : 1;
      map.set(pos, { progress: -i * 0.15, fromColor: from as CellState }); // stagger
    });
    flipProgressRef.current = map;

    if (lastMove !== null) {
      dropRef.current = { pos: lastMove, progress: 0 };
    }
  }, [flippedDiscs, lastMove, board]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const displaySize = Math.min(560, window.innerWidth - 40);
    if (canvas.width !== displaySize * dpr || canvas.height !== displaySize * dpr) {
      canvas.width = displaySize * dpr;
      canvas.height = displaySize * dpr;
      canvas.style.width = displaySize + 'px';
      canvas.style.height = displaySize + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellSize = (displaySize - PADDING * 2) / BOARD_CELLS;
    const offset = PADDING;

    // Board background
    ctx.fillStyle = '#2d8a4e';
    ctx.fillRect(0, 0, displaySize, displaySize);

    // Grid lines
    ctx.strokeStyle = '#1a6b35';
    ctx.lineWidth = 1;
    for (let i = 0; i <= BOARD_CELLS; i++) {
      const p = offset + i * cellSize;
      ctx.beginPath();
      ctx.moveTo(p, offset);
      ctx.lineTo(p, offset + BOARD_CELLS * cellSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offset, p);
      ctx.lineTo(offset + BOARD_CELLS * cellSize, p);
      ctx.stroke();
    }

    // Guide dots (4 standard positions)
    ctx.fillStyle = '#1a6b35';
    for (const [r, c] of [[2, 2], [2, 6], [6, 2], [6, 6]]) {
      ctx.beginPath();
      ctx.arc(offset + c * cellSize, offset + r * cellSize, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const legalSet = new Set(legalMoves);

    // Last move highlight
    if (lastMove !== null) {
      const r = Math.floor(lastMove / 8);
      const c = lastMove % 8;
      ctx.fillStyle = 'rgba(255, 200, 0, 0.4)';
      ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
    }

    // Draw discs
    let hasAnimation = false;
    for (let pos = 0; pos < 64; pos++) {
      const cell = board[pos];
      const r = Math.floor(pos / 8);
      const c = pos % 8;
      const cx = offset + c * cellSize + cellSize / 2;
      const cy = offset + r * cellSize + cellSize / 2;
      const radius = cellSize * 0.4;

      if (cell === 0) {
        // Legal move indicator
        if (legalSet.has(pos) && !disabled) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.beginPath();
          ctx.arc(cx, cy, cellSize * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }

      const flipData = flipProgressRef.current.get(pos);
      const isDrop = dropRef.current && dropRef.current.pos === pos;

      if (flipData && flipData.progress < 1) {
        hasAnimation = true;
        // Flip animation: scaleX squeeze
        const p = Math.max(0, flipData.progress);
        const scaleX = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
        const showColor = p < 0.5 ? flipData.fromColor : cell;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scaleX, 1);
        drawDisc(ctx, 0, 0, radius, showColor);
        ctx.restore();
      } else if (isDrop && dropRef.current!.progress < 1) {
        hasAnimation = true;
        const scale = dropRef.current!.progress;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        drawDisc(ctx, 0, 0, radius, cell);
        ctx.restore();
      } else {
        drawDisc(ctx, cx, cy, radius, cell);
      }
    }

    // Update animation progress
    if (hasAnimation) {
      flipProgressRef.current.forEach((data) => {
        data.progress += 0.06;
      });
      if (dropRef.current) {
        dropRef.current.progress += 0.08;
      }
    }

    // Border
    ctx.strokeStyle = '#1a4830';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, displaySize - 2, displaySize - 2);

    if (hasAnimation) {
      animRef.current = requestAnimationFrame(draw);
    }
  }, [board, legalMoves, lastMove, disabled]);

  // Redraw on state changes and animate
  useEffect(() => {
    cancelAnimationFrame(animRef.current);
    draw();
    // kick animation loop if we have flips
    if (flipProgressRef.current.size > 0 || dropRef.current) {
      animRef.current = requestAnimationFrame(draw);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - PADDING;
    const y = e.clientY - rect.top - PADDING;
    const cellSize = getCellSize();
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    if (row < 0 || row >= 8 || col < 0 || col >= 8) return;
    const pos = row * 8 + col;
    if (legalMoves.includes(pos)) {
      onCellClick(pos);
    }
  }, [disabled, legalMoves, onCellClick, getCellSize]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ cursor: disabled ? 'default' : 'pointer', borderRadius: '4px' }}
    />
  );
}

function drawDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: CellState) {
  if (color === 0) return;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.arc(cx + 1, cy + 1, radius, 0, Math.PI * 2);
  ctx.fill();

  // Disc with gradient
  const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, 0, cx, cy, radius);
  if (color === 1) {
    grad.addColorStop(0, '#4a4a4a');
    grad.addColorStop(1, '#1a1a1a');
  } else {
    grad.addColorStop(0, '#fffbe8');
    grad.addColorStop(1, '#f0ead6');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Subtle edge
  ctx.strokeStyle = color === 1 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}
