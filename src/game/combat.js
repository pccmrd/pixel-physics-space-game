import { TAU, clamp, dot, norm } from '../core/math.js';
import { Rng } from '../core/rng.js';

const ENEMY_STYLES = {
  scout: { hp: 44, radius: 7, speed: 62, damage: 7, cooldown: 0.95, bounty: 90, color: '#ff7aa8' },
  lancer: { hp: 68, radius: 9, speed: 48, damage: 11, cooldown: 1.35, bounty: 145, color: '#ff9966' }
};

export class CombatSystem {
  constructor(world, ship, particles) {
    this.world = world;
    this.ship = ship;
    this.particles = particles;
    this.rng = new Rng(0xba77);
    this.enemies = [];
    this.projectiles = [];
    this.kills = 0;
    this.waveTimer = 62;
    this.idCounter = 1;
    this.spawnInitial();
  }

  spawnInitial() {
    this.spawnEnemyAt('kestrel', 'scout', 0.35);
    this.spawnEnemyAt('kestrel', 'lancer', 2.1);
    this.spawnEnemyAt('cinder', 'scout', 4.1);
    this.spawnEnemyAt('vela', 'lancer', 5.2);
  }

  spawnEnemyAt(bodyId, rank = 'scout', angle = null) {
    const body = this.world.bodyById.get(bodyId) || this.world.bodies[0];
    const a = angle ?? this.rng.range(0, TAU);
    const distance = body.radius + this.rng.range(145, 240);
    let x = body.x + Math.cos(a) * distance;
    let y = body.y + Math.sin(a) * distance;
    if (this.world.sampleMaterial(x, y, true)) {
      x += Math.cos(a) * 40;
      y += Math.sin(a) * 40;
    }
    const style = ENEMY_STYLES[rank] || ENEMY_STYLES.scout;
    this.enemies.push({
      id: this.idCounter++,
      rank,
      x, y,
      vx: -Math.sin(a) * 18,
      vy: Math.cos(a) * 18,
      angle: a + Math.PI,
      hp: style.hp,
      maxHp: style.hp,
      radius: style.radius,
      cooldown: this.rng.range(0.5, 1.7),
      flash: 0,
      dead: false,
      orbitSign: this.rng.chance(0.5) ? 1 : -1,
      homeId: bodyId,
      color: style.color,
      style
    });
  }

  spawnWave() {
    if (this.enemies.length >= 4) return;
    const choices = this.world.bodies.filter((b) => Math.hypot(b.x - this.ship.x, b.y - this.ship.y) > 420);
    const body = choices.length ? this.rng.pick(choices) : this.rng.pick(this.world.bodies);
    const count = this.rng.int(1, 2);
    for (let k = 0; k < count; k++) {
      this.spawnEnemyAt(body.id, this.rng.chance(0.32) ? 'lancer' : 'scout', this.rng.range(0, TAU));
    }
    this.ship.notify('UNIDENTIFIED HOSTILE TRANSPONDERS', 'warn', { type: 'wave' });
    this.world.pushEvent({ type: 'alarm', x: this.ship.x, y: this.ship.y });
  }

  lineOfSight(x, y, dirX, dirY, maxDist) {
    const hit = this.world.raycast(x, y, dirX, dirY, maxDist);
    return !hit || hit.distance > maxDist - 12;
  }

  spawnProjectile(options) {
    this.projectiles.push({
      owner: 'enemy',
      x: 0, y: 0, vx: 0, vy: 0,
      life: 3.2,
      radius: 2,
      damage: 7,
      explosive: false,
      color: '#ff7aa8',
      trailTimer: 0,
      ...options
    });
  }

  fireCannon(aimDir) {
    const ship = this.ship;
    if (ship.weaponCooldown > 0) return false;
    const d = norm(aimDir.x, aimDir.y, Math.cos(ship.angle), Math.sin(ship.angle));
    ship.weaponCooldown = 0.19;
    const speed = 310;
    const x = ship.x + d.x * 12;
    const y = ship.y + d.y * 12;
    const vx = ship.vx * 0.65 + d.x * speed;
    const vy = ship.vy * 0.65 + d.y * speed;
    this.spawnProjectile({
      owner: 'player', x, y, vx, vy,
      life: 2.6, radius: 2.2, damage: 25, explosive: true,
      color: '#8ceaff'
    });
    this.world.pushEvent({ type: 'cannon', x, y, vx, vy });
    return true;
  }

  emitHitSparks(x, y, color = '#ff9ab8', count = 5) {
    for (let k = 0; k < count; k++) {
      this.particles.spawn({
        type: 'spark', x, y,
        vx: this.rng.range(-45, 45),
        vy: this.rng.range(-45, 45),
        life: this.rng.range(0.12, 0.4),
        size: this.rng.range(0.7, 1.6),
        color, glow: true, drag: 0.5
      });
    }
  }

  damageEnemy(enemy, amount, sourceX, sourceY) {
    if (enemy.dead || amount <= 0) return;
    enemy.hp -= amount;
    enemy.flash = 0.12;
    const n = norm(enemy.x - sourceX, enemy.y - sourceY, 0, -1);
    this.emitHitSparks(enemy.x, enemy.y, enemy.color, Math.min(8, 2 + Math.round(amount / 5)));
    if (enemy.hp <= 0) {
      enemy.dead = true;
      this.kills++;
      const bounty = enemy.style.bounty;
      this.ship.credits += bounty;
      this.ship.notify(`HOSTILE DISABLED  +${bounty} CR`, 'good', { type: 'kill', enemy: enemy.rank });
      this.world.pushEvent({ type: 'enemyDestroyed', x: enemy.x, y: enemy.y, radius: 22, n });
    }
  }

  explosionDamage(x, y, radius, damage, damageShip, owner) {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const d = Math.hypot(enemy.x - x, enemy.y - y);
      if (d < radius * 1.5) this.damageEnemy(enemy, damage * (1 - d / (radius * 1.5)), x, y);
    }
    const sd = Math.hypot(this.ship.x - x, this.ship.y - y);
    if (damageShip && sd < radius * 1.15) {
      const falloff = 1 - sd / (radius * 1.15);
      const multiplier = owner === 'player' ? 0.35 : 1;
      this.ship.damage(damage * 0.42 * falloff * multiplier, 'BLAST RADIUS', this.world);
    }
  }

  projectileImpact(projectile, sample = null) {
    const p = projectile;
    if (p.explosive) {
      const radius = 12;
      const power = 78;
      this.world.explode(p.x, p.y, radius, power);
      this.explosionDamage(p.x, p.y, radius, 32, true, p.owner);
    } else {
      const normal = sample?.normal || norm(-p.vx, -p.vy, 0, -1);
      this.particles.emitImpact({
        x: p.x, y: p.y,
        normalX: normal.x, normalY: normal.y,
        power: Math.max(3, p.damage * 0.45)
      });
      this.world.pushEvent({ type: 'projectileImpact', x: p.x, y: p.y, power: p.damage });
    }
  }

  updateEnemies(dt) {
    const ship = this.ship;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.cooldown -= dt;
      const dx = ship.x - enemy.x;
      const dy = ship.y - enemy.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const toShip = norm(dx, dy, 1, 0);
      const tangent = { x: -toShip.y * enemy.orbitSign, y: toShip.x * enemy.orbitSign };
      let ax = tangent.x * enemy.style.speed * 0.35;
      let ay = tangent.y * enemy.style.speed * 0.35;
      if (d > 340) {
        ax += toShip.x * enemy.style.speed;
        ay += toShip.y * enemy.style.speed;
      } else if (d < 165) {
        ax -= toShip.x * enemy.style.speed * 0.85;
        ay -= toShip.y * enemy.style.speed * 0.85;
      }
      const nav = this.world.nearestBody(enemy.x, enemy.y);
      if (nav.altitude < 62) {
        const away = norm(enemy.x - nav.body.x, enemy.y - nav.body.y, 0, -1);
        ax += away.x * 105;
        ay += away.y * 105;
      }
      const g = this.world.gravityAt(enemy.x, enemy.y);
      enemy.vx += (ax + g.x * 0.18) * dt;
      enemy.vy += (ay + g.y * 0.18) * dt;
      const damp = Math.max(0, 1 - 0.12 * dt);
      enemy.vx *= damp;
      enemy.vy *= damp;
      const speed = Math.hypot(enemy.vx, enemy.vy);
      if (speed > 180) {
        enemy.vx *= 180 / speed;
        enemy.vy *= 180 / speed;
      }
      enemy.x += enemy.vx * dt;
      enemy.y += enemy.vy * dt;
      enemy.angle = Math.atan2(dy, dx);

      const terrain = this.world.sampleMaterial(enemy.x, enemy.y, true);
      if (terrain) {
        const n = terrain.normal;
        enemy.x += n.x * 3.2;
        enemy.y += n.y * 3.2;
        const vn = dot(enemy.vx, enemy.vy, n.x, n.y);
        if (vn < 0) {
          enemy.vx -= 1.5 * vn * n.x;
          enemy.vy -= 1.5 * vn * n.y;
        }
        this.damageEnemy(enemy, 12 * dt, enemy.x, enemy.y);
      }

      if (d < 430 && enemy.cooldown <= 0) {
        const lead = norm(ship.x + ship.vx * 0.42 - enemy.x, ship.y + ship.vy * 0.42 - enemy.y, toShip.x, toShip.y);
        if (this.lineOfSight(enemy.x, enemy.y, lead.x, lead.y, d + 40)) {
          const speedShot = 225;
          this.spawnProjectile({
            owner: 'enemy',
            x: enemy.x + lead.x * 11,
            y: enemy.y + lead.y * 11,
            vx: enemy.vx * 0.35 + lead.x * speedShot,
            vy: enemy.vy * 0.35 + lead.y * speedShot,
            life: 3.4,
            damage: enemy.style.damage,
            color: enemy.color,
            explosive: enemy.rank === 'lancer' && this.rng.chance(0.24)
          });
          enemy.cooldown = enemy.style.cooldown + this.rng.range(0.1, 0.55);
          this.world.pushEvent({ type: 'enemyFire', x: enemy.x, y: enemy.y });
        }
      }
    }
  }

  updateProjectiles(dt) {
    const ship = this.ship;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }
      const g = this.world.gravityAt(p.x, p.y);
      p.vx += g.x * 0.06 * dt;
      p.vy += g.y * 0.06 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.trailTimer -= dt;
      if (p.trailTimer <= 0) {
        p.trailTimer = 0.025;
        this.particles.spawn({
          type: 'spark', x: p.x, y: p.y,
          vx: -p.vx * 0.014 + this.rng.range(-4, 4),
          vy: -p.vy * 0.014 + this.rng.range(-4, 4),
          life: 0.22, size: p.owner === 'player' ? 1.2 : 0.9,
          color: p.color, glow: true, drag: 0.7
        });
      }

      let remove = false;
      const terrain = this.world.sampleMaterial(p.x, p.y, true);
      if (terrain) {
        this.projectileImpact(p, terrain);
        remove = true;
      } else if (p.owner === 'player') {
        for (const enemy of this.enemies) {
          if (enemy.dead) continue;
          if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.radius + p.radius) {
            this.damageEnemy(enemy, p.damage, p.x - p.vx * 0.02, p.y - p.vy * 0.02);
            this.projectileImpact(p, null);
            remove = true;
            break;
          }
        }
      } else {
        if (Math.hypot(ship.x - p.x, ship.y - p.y) < ship.radius + p.radius + 1) {
          ship.damage(p.damage, 'PLASMA HIT', this.world);
          this.projectileImpact(p, norm(-p.vx, -p.vy, 0, -1));
          remove = true;
        }
      }
      if (remove) this.projectiles.splice(i, 1);
    }
  }

  laserDamage(aimDir, range, dps, dt, terrainDistance = Infinity) {
    const ship = this.ship;
    const d = norm(aimDir.x, aimDir.y, Math.cos(ship.angle), Math.sin(ship.angle));
    const limit = Math.min(range, terrainDistance);
    let hit = null;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - ship.x;
      const dy = enemy.y - ship.y;
      const along = dot(dx, dy, d.x, d.y);
      if (along <= 0 || along > limit) continue;
      const perpendicular = Math.abs(dx * d.y - dy * d.x);
      if (perpendicular < enemy.radius + 3.5) {
        this.damageEnemy(enemy, dps * dt, ship.x, ship.y);
        hit = enemy;
        if (this.rng.chance(0.6)) this.emitHitSparks(ship.x + d.x * along, ship.y + d.y * along, '#ffd27a', 2);
      }
    }
    return hit;
  }

  update(dt) {
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = 68 + this.rng.range(-10, 14);
      this.spawnWave();
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.enemies = this.enemies.filter((e) => !e.dead && e.hp > 0);
  }

  threatsNear(ship, radius = 950) {
    let count = 0;
    for (const e of this.enemies) {
      if (Math.hypot(e.x - ship.x, e.y - ship.y) < radius) count++;
    }
    return count;
  }
}
