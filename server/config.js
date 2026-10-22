// All gameplay tuning lives here. Units: pixels and seconds.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SUBSTEPS = 4; // physics substeps per tick, keeps fast shots from tunnelling
export const SNAPSHOT_EVERY = 2; // ticks between snapshots (30 Hz)

export const MODES = {
  '1v1': { teamSize: 1, width: 900, height: 480, goalWidth: 150 },
  '2v2': { teamSize: 2, width: 1100, height: 560, goalWidth: 170 },
  '3v3': { teamSize: 3, width: 1300, height: 640, goalWidth: 190 },
};
export const QUICKPLAY_MODES = ['1v1', '2v2'];
export const PRIVATE_MODES = ['1v1', '2v2', '3v3'];

// Kickoff spots per team size, as fractions of the half-pitch measured from the centre.
export const FORMATIONS = {
  1: [{ fx: 0.45, fy: 0 }],
  2: [{ fx: 0.3, fy: -0.25 }, { fx: 0.65, fy: 0.25 }],
  3: [{ fx: 0.25, fy: 0 }, { fx: 0.6, fy: -0.4 }, { fx: 0.6, fy: 0.4 }],
};

export const MATCH = {
  duration: 180, // seconds of regulation time, then golden goal
  firstCountdown: 3,
  countdown: 2,
  goalPause: 2.5,
  endPause: 8,
};

export const FIELD = {
  goalDepth: 45,
  postRadius: 7,
  playerMargin: 40, // how far outside the lines players may run
  crossbarHeight: 42, // ball higher than this flies over the goal
};

export const PLAYER = {
  radius: 20,
  mass: 3,
  maxSpeed: 230,
  response: 9, // how quickly velocity approaches the desired velocity
  chargingSpeedMul: 0.7,
  recoverSpeedMul: 0.45,
  height: 34, // ball above this passes over players
  kickReach: 10,
  kickCooldown: 0.2,
  staminaMax: 100,
  staminaRegen: 22,
  staminaRegenDelay: 0.6,
  wallBounce: 0.3,
  playerBounce: 0.3,
};

export const BALL = {
  radius: 10,
  mass: 1,
  groundFriction: 0.75, // exponential decay per second when rolling
  rollResistance: 30, // constant deceleration when rolling
  airDrag: 0.12,
  gravity: 980,
  groundBounce: 0.55, // vertical restitution
  minBounceSpeed: 70,
  bounceSlowdown: 0.92, // horizontal speed kept on each ground bounce
  wallBounce: 0.78,
  playerBounce: 0.45,
  postBounce: 0.7,
  spinDecay: 1.5,
  maxSpeed: 1800,
};

export const KICK = {
  chargeTime: 0.9, // seconds to full charge
  minPower: 420,
  maxPower: 1150,
  grace: 0.15, // a released kick waits this long for the ball to come in reach
  maxCurve: 0.75, // spin (rad/s of velocity rotation) at full sideways movement
  lobPowerMul: 0.72,
  lobLiftMin: 260,
  lobLiftMax: 520,
  passMin: 320,
  passMax: 900,
  passCone: (55 * Math.PI) / 180,
  passSolo: 480,
  megaMul: 1.45,
};

export const DASH = { cost: 30, speed: 560, time: 0.18, massMul: 2.5 };

export const TACKLE = {
  cost: 40,
  speed: 620,
  time: 0.38,
  recover: 0.35,
  stun: 1.0,
  immunity: 1.2,
  knock: 380,
  ballPoke: 650,
};

export const POWERUP = {
  radius: 14,
  spawnMin: 10,
  spawnMax: 16,
  maxOnField: 2,
  lifetime: 15,
  types: {
    speed: { duration: 7, speedMul: 1.35 },
    mega: { duration: 8 },
    giant: { duration: 8, radiusMul: 1.5, massMul: 2.2 },
    energy: { duration: 7 },
  },
};
