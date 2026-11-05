import { useRef, useEffect } from "react";
import { useGameSounds } from "@freegamestore/games";

interface GameProps {
  onScore: (score: number) => void;
  onGameOver: () => void;
  onStats?: (stats: { lives: number; level: number }) => void;
  paused?: boolean;
}

/* ---------- constants ---------- */

const SHIP_RADIUS = 15;
const SHIP_TURN_SPEED = 4.5; // rad/s
const SHIP_THRUST = 300;
const SHIP_DRAG = 0.99;
const BULLET_SPEED = 500;
const BULLET_LIFETIME = 1.2; // seconds
const BULLET_COOLDOWN = 0.15;
const MAX_BULLETS = 12;

const ASTEROID_SPEED_BASE = 40;
const ASTEROID_SPEED_RANGE = 60;
const ASTEROID_SIZES: { radius: number; score: number }[] = [
  { radius: 40, score: 20 },
  { radius: 20, score: 50 },
  { radius: 10, score: 100 },
];
const INITIAL_ASTEROIDS = 4;
const EXTRA_LIFE_EVERY = 10000;
const INVULN_TIME = 3; // seconds after respawn
const DEATH_PAUSE = 1.5; // seconds pause on death

/* ---------- types ---------- */

interface Vec2 {
  x: number;
  y: number;
}

interface Ship {
  pos: Vec2;
  vel: Vec2;
  angle: number; // radians, 0 = up
  thrusting: boolean;
  invulnTimer: number;
}

interface Bullet {
  pos: Vec2;
  vel: Vec2;
  life: number;
}

interface Asteroid {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  sizeIdx: number; // 0=large, 1=medium, 2=small
  angle: number;
  rotSpeed: number;
  shape: number[]; // radii offsets for irregular shape
}

interface State {
  ship: Ship;
  bullets: Bullet[];
  asteroids: Asteroid[];
  score: number;
  lives: number;
  level: number;
  nextLifeAt: number;
  shakeTimer: number;
  deathTimer: number;
  gameOver: boolean;
  width: number;
  height: number;
  bulletCooldown: number;
}

/* ---------- input ---------- */

interface Input {
  left: boolean;
  right: boolean;
  thrust: boolean;
  shoot: boolean;
}

type Control = keyof Input;

const KEY_CONTROLS: Record<string, Control> = {
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
  arrowup: "thrust",
  w: "thrust",
  " ": "shoot",
};

/** Case-insensitive so WASD still works with Caps Lock or Shift held. */
export function controlForKey(key: string): Control | undefined {
  return KEY_CONTROLS[key.toLowerCase()];
}

// Touch layout: outer quarters rotate, centre top thrusts, centre bottom fires.
const TOUCH_SIDE = 0.25;
const TOUCH_SPLIT = 0.5;

/** x, y are fractions (0..1) of the canvas size. */
export function touchRegion(x: number, y: number): Control {
  if (x < TOUCH_SIDE) return "left";
  if (x > 1 - TOUCH_SIDE) return "right";
  return y < TOUCH_SPLIT ? "thrust" : "shoot";
}

/** Size the backing store in device pixels; drawing stays in CSS pixels. */
export function sizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ---------- helpers ---------- */

function wrap(pos: Vec2, w: number, h: number): void {
  if (pos.x < 0) pos.x += w;
  if (pos.x > w) pos.x -= w;
  if (pos.y < 0) pos.y += h;
  if (pos.y > h) pos.y -= h;
}

function dist(a: Vec2, b: Vec2, w: number, h: number): number {
  // shortest wrapped distance
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (dx > w / 2) dx = w - dx;
  if (dy > h / 2) dy = h - dy;
  return Math.sqrt(dx * dx + dy * dy);
}

function makeAsteroidShape(): number[] {
  const verts = 8 + Math.floor(Math.random() * 5);
  const shape: number[] = [];
  for (let i = 0; i < verts; i++) {
    shape.push(0.7 + Math.random() * 0.6); // radius multiplier 0.7..1.3
  }
  return shape;
}

function spawnAsteroid(w: number, h: number, sizeIdx: number, pos?: Vec2): Asteroid {
  const size = ASTEROID_SIZES[sizeIdx]!;
  const angle = Math.random() * Math.PI * 2;
  const speed = ASTEROID_SPEED_BASE + Math.random() * ASTEROID_SPEED_RANGE;
  let p: Vec2;
  if (pos) {
    p = { ...pos };
  } else {
    // spawn from edge
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: p = { x: Math.random() * w, y: 0 }; break;
      case 1: p = { x: w, y: Math.random() * h }; break;
      case 2: p = { x: Math.random() * w, y: h }; break;
      default: p = { x: 0, y: Math.random() * h }; break;
    }
  }
  return {
    pos: p,
    vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
    radius: size.radius,
    sizeIdx,
    angle: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 2,
    shape: makeAsteroidShape(),
  };
}

function createInitialState(w: number, h: number): State {
  const asteroids: Asteroid[] = [];
  for (let i = 0; i < INITIAL_ASTEROIDS; i++) {
    asteroids.push(spawnAsteroid(w, h, 0));
  }
  return {
    ship: {
      pos: { x: w / 2, y: h / 2 },
      vel: { x: 0, y: 0 },
      angle: -Math.PI / 2, // pointing up
      thrusting: false,
      invulnTimer: INVULN_TIME,
    },
    bullets: [],
    asteroids,
    score: 0,
    lives: 3,
    level: 1,
    nextLifeAt: EXTRA_LIFE_EVERY,
    shakeTimer: 0,
    deathTimer: 0,
    gameOver: false,
    width: w,
    height: h,
    bulletCooldown: 0,
  };
}

/* ---------- update ---------- */

function moveAsteroids(s: State, dt: number): void {
  for (const a of s.asteroids) {
    a.pos.x += a.vel.x * dt;
    a.pos.y += a.vel.y * dt;
    a.angle += a.rotSpeed * dt;
    wrap(a.pos, s.width, s.height);
  }
}

function update(s: State, input: Input, dt: number): void {
  if (s.gameOver) return;

  const { ship, width: w, height: h } = s;

  // Death pause
  if (s.deathTimer > 0) {
    s.deathTimer -= dt;
    s.shakeTimer -= dt;
    // Still move asteroids during death pause
    moveAsteroids(s, dt);
    return;
  }

  // Ship rotation
  if (input.left) ship.angle -= SHIP_TURN_SPEED * dt;
  if (input.right) ship.angle += SHIP_TURN_SPEED * dt;

  // Ship thrust
  ship.thrusting = input.thrust;
  if (input.thrust) {
    ship.vel.x += Math.cos(ship.angle) * SHIP_THRUST * dt;
    ship.vel.y += Math.sin(ship.angle) * SHIP_THRUST * dt;
  }

  // Ship drag + move
  ship.vel.x *= SHIP_DRAG;
  ship.vel.y *= SHIP_DRAG;
  ship.pos.x += ship.vel.x * dt;
  ship.pos.y += ship.vel.y * dt;
  wrap(ship.pos, w, h);

  // Invulnerability timer
  if (ship.invulnTimer > 0) {
    ship.invulnTimer -= dt;
  }

  // Shoot
  s.bulletCooldown -= dt;
  if (input.shoot && s.bulletCooldown <= 0 && s.bullets.length < MAX_BULLETS) {
    s.bullets.push({
      pos: {
        x: ship.pos.x + Math.cos(ship.angle) * SHIP_RADIUS,
        y: ship.pos.y + Math.sin(ship.angle) * SHIP_RADIUS,
      },
      vel: {
        x: Math.cos(ship.angle) * BULLET_SPEED + ship.vel.x * 0.5,
        y: Math.sin(ship.angle) * BULLET_SPEED + ship.vel.y * 0.5,
      },
      life: BULLET_LIFETIME,
    });
    s.bulletCooldown = BULLET_COOLDOWN;
  }

  // Move bullets
  for (const b of s.bullets) {
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;
    b.life -= dt;
    wrap(b.pos, w, h);
  }
  s.bullets = s.bullets.filter((b) => b.life > 0);

  moveAsteroids(s, dt);

  // Bullet-asteroid collision
  const newAsteroids: Asteroid[] = [];
  const bulletsToRemove = new Set<number>();

  for (let ai = s.asteroids.length - 1; ai >= 0; ai--) {
    const a = s.asteroids[ai]!;
    let hit = false;
    for (let bi = 0; bi < s.bullets.length; bi++) {
      if (bulletsToRemove.has(bi)) continue;
      const b = s.bullets[bi]!;
      if (dist(a.pos, b.pos, w, h) < a.radius) {
        hit = true;
        bulletsToRemove.add(bi);
        // Score
        s.score += ASTEROID_SIZES[a.sizeIdx]!.score;
        // Extra life
        if (s.score >= s.nextLifeAt) {
          s.lives++;
          s.nextLifeAt += EXTRA_LIFE_EVERY;
        }
        // Split
        if (a.sizeIdx < 2) {
          const nextSize = a.sizeIdx + 1;
          for (let k = 0; k < 2; k++) {
            newAsteroids.push(spawnAsteroid(w, h, nextSize, { x: a.pos.x, y: a.pos.y }));
          }
        }
        break;
      }
    }
    if (hit) {
      s.asteroids.splice(ai, 1);
    }
  }

  s.bullets = s.bullets.filter((_, i) => !bulletsToRemove.has(i));
  s.asteroids.push(...newAsteroids);

  // Ship-asteroid collision
  if (ship.invulnTimer <= 0) {
    for (const a of s.asteroids) {
      if (dist(ship.pos, a.pos, w, h) < a.radius + SHIP_RADIUS * 0.6) {
        s.lives--;
        s.shakeTimer = 0.4;
        if (s.lives <= 0) {
          s.gameOver = true;
          return;
        }
        // Respawn ship at center
        ship.pos.x = w / 2;
        ship.pos.y = h / 2;
        ship.vel.x = 0;
        ship.vel.y = 0;
        ship.invulnTimer = INVULN_TIME;
        s.deathTimer = DEATH_PAUSE;
        break;
      }
    }
  }

  // Level complete — spawn new wave
  if (s.asteroids.length === 0) {
    s.level++;
    const count = INITIAL_ASTEROIDS + s.level - 1;
    for (let i = 0; i < count; i++) {
      s.asteroids.push(spawnAsteroid(w, h, 0));
    }
    // The new wave spawns at the edges wherever the ship is
    ship.invulnTimer = INVULN_TIME;
  }

  // Decay shake
  if (s.shakeTimer > 0) s.shakeTimer -= dt;
}

/* ---------- render ---------- */

function renderTouchZones(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const left = w * TOUCH_SIDE;
  const right = w * (1 - TOUCH_SIDE);
  const split = h * TOUCH_SPLIT;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(left, 0);
  ctx.lineTo(left, h);
  ctx.moveTo(right, 0);
  ctx.lineTo(right, h);
  ctx.moveTo(left, split);
  ctx.lineTo(right, split);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.font = "600 12px Manrope, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("\u25C0 ROTATE", left / 2, h - 16);
  ctx.fillText("ROTATE \u25B6", (right + w) / 2, h - 16);
  ctx.fillText("THRUST", w / 2, split - 16);
  ctx.fillText("FIRE", w / 2, h - 16);
  ctx.restore();
}

function render(ctx: CanvasRenderingContext2D, s: State, showTouchZones: boolean): void {
  const { width: w, height: h, ship } = s;

  // Screen shake
  ctx.save();
  if (s.shakeTimer > 0) {
    const intensity = s.shakeTimer * 20;
    ctx.translate(
      (Math.random() - 0.5) * intensity,
      (Math.random() - 0.5) * intensity,
    );
  }

  // Background
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  if (showTouchZones) renderTouchZones(ctx, w, h);

  // Asteroids
  ctx.strokeStyle = "#d4d4d4";
  ctx.lineWidth = 1.5;
  for (const a of s.asteroids) {
    ctx.save();
    ctx.translate(a.pos.x, a.pos.y);
    ctx.rotate(a.angle);
    ctx.beginPath();
    const verts = a.shape.length;
    for (let i = 0; i <= verts; i++) {
      const idx = i % verts;
      const r = a.radius * a.shape[idx]!;
      const angle = (idx / verts) * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Bullets
  ctx.fillStyle = "#ffffff";
  for (const b of s.bullets) {
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ship (skip during death pause)
  if (s.deathTimer <= 0) {
    // Blink when invulnerable
    const visible = ship.invulnTimer <= 0 || Math.floor(ship.invulnTimer * 10) % 2 === 0;
    if (visible) {
      ctx.save();
      ctx.translate(ship.pos.x, ship.pos.y);
      ctx.rotate(ship.angle);

      // Ship triangle
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(SHIP_RADIUS, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.7, -SHIP_RADIUS * 0.7);
      ctx.lineTo(-SHIP_RADIUS * 0.4, 0);
      ctx.lineTo(-SHIP_RADIUS * 0.7, SHIP_RADIUS * 0.7);
      ctx.closePath();
      ctx.stroke();

      // Thrust flame
      if (ship.thrusting) {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const flicker = 0.6 + Math.random() * 0.6;
        ctx.moveTo(-SHIP_RADIUS * 0.4, -SHIP_RADIUS * 0.3);
        ctx.lineTo(-SHIP_RADIUS * (0.7 + flicker * 0.5), 0);
        ctx.lineTo(-SHIP_RADIUS * 0.4, SHIP_RADIUS * 0.3);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  ctx.restore();
}

/* ---------- component ---------- */

export function Game({ onScore, onGameOver, onStats, paused }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<State | null>(null);
  const inputRef = useRef<Input>({ left: false, right: false, thrust: false, shoot: false });
  const onScoreRef = useRef(onScore);
  const onGameOverRef = useRef(onGameOver);
  const onStatsRef = useRef(onStats);
  const pausedRef = useRef(paused);
  const rafRef = useRef(0);
  const lastTimeRef = useRef(0);
  const gameOverFiredRef = useRef(false);
  const sounds = useGameSounds();
  const soundsRef = useRef(sounds);

  onScoreRef.current = onScore;
  onGameOverRef.current = onGameOver;
  onStatsRef.current = onStats;
  pausedRef.current = paused;
  soundsRef.current = sounds;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getSize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    };

    const ctx = canvas.getContext("2d")!;
    const { w, h } = getSize();
    sizeCanvas(canvas, ctx, w, h);
    stateRef.current = createInitialState(w, h);
    gameOverFiredRef.current = false;

    // Keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      const control = controlForKey(e.key);
      if (!control) return;
      inputRef.current[control] = true;
      if (control === "shoot") e.preventDefault();
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const control = controlForKey(e.key);
      if (control) inputRef.current[control] = false;
    };
    // A key released while the window is unfocused never fires keyup
    const handleBlur = () => {
      inputRef.current = { left: false, right: false, thrust: false, shoot: false };
    };

    // Touch controls: see touchRegion(). Zones are drawn on coarse-pointer
    // devices, or from the first touch on anything else.
    let showTouchZones = window.matchMedia("(pointer: coarse)").matches;
    const activeTouches = new Map<number, Control>();

    const getRegion = (touch: Touch): Control => {
      const rect = canvas.getBoundingClientRect();
      return touchRegion((touch.clientX - rect.left) / rect.width, (touch.clientY - rect.top) / rect.height);
    };

    const updateTouchInput = () => {
      const inp = inputRef.current;
      inp.left = false;
      inp.right = false;
      inp.thrust = false;
      inp.shoot = false;
      for (const region of activeTouches.values()) inp[region] = true;
    };

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      showTouchZones = true;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]!;
        activeTouches.set(t.identifier, getRegion(t));
      }
      updateTouchInput();
    };
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]!;
        if (activeTouches.has(t.identifier)) activeTouches.set(t.identifier, getRegion(t));
      }
      updateTouchInput();
    };
    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]!;
        activeTouches.delete(t.identifier);
      }
      updateTouchInput();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

    // Resize
    const handleResize = () => {
      const { w: nw, h: nh } = getSize();
      sizeCanvas(canvas, ctx, nw, nh);
      if (stateRef.current) {
        stateRef.current.width = nw;
        stateRef.current.height = nh;
      }
    };
    window.addEventListener("resize", handleResize);

    // Game loop
    lastTimeRef.current = 0;
    const loop = (time: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      if (pausedRef.current) {
        lastTimeRef.current = time;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      const s = stateRef.current!;
      const prevScore = s.score;
      const prevBullets = s.bullets.length;
      update(s, inputRef.current, dt);
      onScoreRef.current(s.score);
      onStatsRef.current?.({ lives: s.lives, level: s.level });

      // Sound on shoot (new bullet appeared)
      if (s.bullets.length > prevBullets) {
        soundsRef.current.playMove();
      }
      // Sound on asteroid destroy (score increased)
      if (s.score > prevScore) {
        soundsRef.current.playScore();
      }

      if (s.gameOver && !gameOverFiredRef.current) {
        gameOverFiredRef.current = true;
        soundsRef.current.playGameOver();
        onGameOverRef.current();
      }

      render(ctx, s, showTouchZones);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchEnd);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
      style={{ background: "#0a0a0a", touchAction: "none" }}
    />
  );
}
