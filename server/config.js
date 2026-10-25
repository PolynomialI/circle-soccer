// All gameplay tuning lives here. Units: pixels and seconds.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SUBSTEPS = 6; // physics substeps per tick, keeps fast shots from tunnelling
export const SNAPSHOT_EVERY = 2; // ticks between snapshots (30 Hz)

export const MODES = {
  '1v1': { teamSize: 1, width: 1400, height: 800, goalWidth: 210 },
  '2v2': { teamSize: 2, width: 1800, height: 1000, goalWidth: 240 },
  '3v3': { teamSize: 3, width: 2200, height: 1200, goalWidth: 270 },
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
  goalDepth: 50,
  postRadius: 6,
  playerMargin: 40, // safety box around the pitch; players are normally kept inside the lines
  crossbarHeight: 80, // ball higher than this flies over the goal
};

export const PLAYER = {
  radius: 16,
  mass: 3,
  maxSpeed: 270,
  response: 36, // how quickly velocity approaches the desired velocity (36 = ~full speed in 3 ticks)
  turnRate: 9, // rad/s the running direction swings round (instant when starting from a standstill)
  aimTurnRate: 14, // rad/s the aim swings round when using the aim keys
  chargingSpeedMul: 0.75,
  recoverSpeedMul: 0.45,
  height: 30, // ball above this passes over players
  kickReach: 8,
  kickCooldown: 0.2,
  staminaMax: 100,
  staminaRegen: 22,
  staminaRegenDelay: 0.6,
  wallBounce: 0.1,
  playerBounce: 0.6,
};

// Touching a loose ball picks it up; it then rides in front of the carrier until
// it is kicked, stolen by an opponent running into it, or knocked loose.
export const POSSESSION = {
  pickupSlack: 2, // extra distance beyond touching that still counts as a pickup
  holdGap: 1, // gap between carrier and carried ball
  catchSpeed: 750, // balls faster than this bounce off players instead of sticking
  turnRate: 16, // rad/s the carried ball swings around to the aim direction
  stealProtect: 0.5, // after a steal the ball can't be stolen straight back
  regrabDelay: 0.3, // after kicking, the kicker can't instantly grab it again
  loseDelay: 0.6, // after losing the ball, the old carrier can't grab it again
};

export const BALL = {
  radius: 9,
  mass: 1,
  groundFriction: 0.8, // exponential decay per second when rolling
  rollResistance: 40, // constant deceleration when rolling
  airDrag: 0.1,
  gravity: 1100,
  groundBounce: 0.72, // vertical restitution: bouncy, cartoon ball
  minBounceSpeed: 60,
  bounceSlowdown: 0.95, // horizontal speed kept on each ground bounce
  wallBounce: 0.92,
  playerBounce: 0.85,
  postBounce: 1.0,
  spinDecay: 1.4,
  maxSpeed: 2000,
};

export const KICK = {
  chargeTime: 0.9, // seconds to full charge
  minPower: 520,
  maxPower: 1400,
  grace: 0.15, // a released kick waits this long for the ball to come in reach
  maxCurve: 0.75, // spin (rad/s of velocity rotation) at full sideways movement
  megaLiftMax: 520, // only Mega kick shots leave the ground; full charge can clear the crossbar
  lobPowerMul: 0.72,
  lobLiftMin: 320,
  lobLiftMax: 620,
  passMin: 380,
  passMax: 1300,
  passCone: (55 * Math.PI) / 180,
  passSolo: 520,
  megaMul: 1.45,
};

export const DASH = { cost: 30, speed: 700, time: 0.18, massMul: 2.5 };

export const TACKLE = {
  cost: 40,
  speed: 760,
  time: 0.38,
  recover: 0.35,
  stun: 1.0,
  immunity: 1.2,
  knock: 450,
  ballPoke: 750,
};

export const POWERUP = {
  radius: 12,
  spawnMin: 25,
  spawnMax: 40,
  maxOnField: 1,
  lifetime: 15,
  types: {
    speed: { duration: 7, speedMul: 1.35 },
    mega: { duration: 8 },
    giant: { duration: 8, radiusMul: 1.5, massMul: 2.2 },
    energy: { duration: 7 },
  },
};
