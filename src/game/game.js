import { clamp, norm } from '../core/math.js';
import { Input } from '../core/input.js';
import { AudioEngine } from '../core/audio.js';
import { World } from '../world/world.js';
import { Ship } from './ship.js';
import { CombatSystem } from './combat.js';
import { ParticleSystem } from './particles.js';
import { TradeSystem } from './trade.js';
import { UI } from '../ui/hud.js';
import { Renderer } from '../render/renderer.js';

const FIXED_DT = 1 / 60;
const ALTERING_EVENTS = new Set(['grind', 'collapse', 'melt', 'vapor', 'cool', 'blast']);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.world = new World();
    this.ship = new Ship(this.world);
    this.ship.updateMetrics(this.world);
    this.audio = new AudioEngine();
    this.renderer = new Renderer(canvas, this.world);
    this.renderer.camera.x = this.ship.x;
    this.renderer.camera.y = this.ship.y;
    this.input = new Input(canvas, () => this.audio.unlock());
    this.ui = new UI();
    this.particles = new ParticleSystem();
    this.combat = new CombatSystem(this.world, this.ship, this.particles);
    this.trade = new TradeSystem(this.world, this.ship, this.ui);
    this.ui.bind(this.trade, this.audio);

    this.time = 0;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.simRate = 60;
    this.paused = false;
    this.gravityOverlay = false;
    this.aimPoint = null;
    this.aimDir = { x: 1, y: 0 };
    this.beam = { active: false, tool: 'grinder', x1: 0, y1: 0, x2: 0, y2: 0, hit: false };
    this.toolParticleTimer = 0;
    this.laserActive = false;
    this.laserWasActive = false;
    this.energyWarnCooldown = 0;
    this.collectSoundCooldown = 0;
    this.respawnCooldown = 0;

    this.objectiveTexts = [
      'Land manually on a material surface: gear down, low descent rate, legs toward ground.',
      'Grind or melt at least 20 pixels, then collect 6 cargo units with the R magnetic scoop.',
      'Dock quietly at a lit exchange pad and sell cargo with T.',
      'Survey the Vela cryo anomaly and disable two hostile drones.',
      'Free flight: carve caves, collapse unsupported monoliths, melt hulls, trade and explore.'
    ];
    this.objectiveLabels = [
      'MANUAL TOUCHDOWN', 'MATERIAL HARVEST', 'FIRST EXCHANGE', 'DEEP SURVEY'
    ];
    this.objectiveRewards = [180, 260, 360, 700];
    this.objectiveText = this.objectiveTexts[0];
    this.mission = {
      stage: 0,
      alteredCells: 0,
      totalCollected: 0,
      prevCargo: this.ship.cargoUsed(),
      landed: false,
      sold: false,
      soldUnits: 0
    };

    this.ui.log('PIXEL MATERIAL FIELD ONLINE', 'good');
    this.ui.log('SIX GRAVITY WELLS · CONTINUOUS SURFACE SIMULATION', '');
    this.ui.log('W/S THRUST · A/D TORQUE · Q/E RCS · H FOR REFERENCE', '');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setTool(tool) {
    this.ship.tool = tool;
    this.ui.log(`TOOL SELECTED: ${tool.toUpperCase()}`, '');
    this.audio.play('ui');
  }

  handleDiscreteInput() {
    const input = this.input;
    if (input.consumePress('KeyP')) {
      this.paused = !this.paused;
      this.ui.log(this.paused ? 'SIMULATION PAUSED' : 'SIMULATION RESUMED', this.paused ? 'warn' : 'good');
      this.audio.play('ui');
    }
    if (input.consumePress('Escape')) {
      if (this.trade.open) this.trade.close();
      else if (this.ui.helpOpen) this.ui.toggleHelp(false);
      else if (this.ui.mapOpen) this.ui.toggleMap(false);
      this.audio.play('ui');
    }
    if (input.consumePress('KeyH')) {
      this.ui.toggleHelp();
      this.audio.play('ui');
    }
    if (input.consumePress('Tab')) {
      this.ui.toggleMap();
      this.audio.play('ui');
    }
    if (input.consumePress('KeyT')) {
      this.trade.toggle();
      this.audio.play('ui');
    }
    if (input.consumePress('KeyM')) {
      const muted = this.audio.toggleMute();
      this.ui.log(muted ? 'AUDIO MUTED' : 'AUDIO ENABLED', '');
    }
    if (input.consumePress('KeyB')) {
      this.gravityOverlay = !this.gravityOverlay;
      this.ui.log(this.gravityOverlay ? 'GRAVITY VECTOR FIELD ENABLED' : 'GRAVITY VECTOR FIELD HIDDEN', '');
      this.audio.play('ui');
    }
    if (input.consumePress('KeyV')) {
      this.ship.gear = !this.ship.gear;
      this.ship.notify(`LANDING GEAR ${this.ship.gear ? 'DOWN' : 'UP'}`, '', { type: 'gear' });
      this.audio.play('ui');
    }
    if (input.consumePress('KeyR')) {
      this.ship.scoop = !this.ship.scoop;
      this.ship.notify(`MAGNETIC SCOOP ${this.ship.scoop ? 'ON' : 'OFF'}`, this.ship.scoop ? 'good' : '', { type: 'scoop' });
      this.audio.play('ui');
    }

    if (this.trade.open) {
      for (let i = 1; i <= 8; i++) {
        if (input.consumePress(`Digit${i}`)) {
          this.trade.actionIndex(i - 1);
          break;
        }
      }
    } else {
      if (input.consumePress('Digit1')) this.setTool('grinder');
      else if (input.consumePress('Digit2')) this.setTool('laser');
      else if (input.consumePress('Digit3')) this.setTool('cannon');
    }
  }

  computeAim() {
    const forward = this.ship.forwardVector();
    if (this.input.pointer.inside) {
      const point = this.renderer.screenToWorld(this.input.pointer.x, this.input.pointer.y);
      this.aimPoint = point;
      const d = norm(point.x - this.ship.x, point.y - this.ship.y, forward.x, forward.y);
      this.aimDir = d.l > 4 ? { x: d.x, y: d.y } : forward;
    } else {
      this.aimPoint = null;
      this.aimDir = forward;
    }
  }

  updateTools(dt, aimDir) {
    this.beam.active = false;
    this.laserActive = false;
    const wasActive = this.laserWasActive;
    this.toolParticleTimer -= dt;
    const modalOpen = this.trade.open || this.ui.helpOpen || this.ui.mapOpen;
    const primary = this.input.isDown('Mouse0') || this.input.isDown('KeyF');
    const cannonHeld = this.input.isDown('Space') || this.input.isDown('Mouse2') || (this.ship.tool === 'cannon' && primary);

    if (!modalOpen && cannonHeld) {
      this.combat.fireCannon(aimDir);
    }

    if (!modalOpen && primary && this.ship.tool !== 'cannon') {
      const laser = this.ship.tool === 'laser';
      const cost = (laser ? 15 : 5) * dt;
      if (this.ship.consumeEnergy(cost)) {
        const range = laser ? 110 : 42;
        const hit = this.world.raycast(this.ship.x, this.ship.y, aimDir.x, aimDir.y, range);
        const x1 = this.ship.x + aimDir.x * 10;
        const y1 = this.ship.y + aimDir.y * 10;
        const x2 = hit ? hit.x : this.ship.x + aimDir.x * range;
        const y2 = hit ? hit.y : this.ship.y + aimDir.y * range;
        this.beam = { active: true, tool: this.ship.tool, x1, y1, x2, y2, hit: Boolean(hit) };
        this.ship.heat = clamp(this.ship.heat + (laser ? 9 : 2.5) * dt, 0, 100);

        if (laser) {
          this.laserActive = true;
          const terrainDistance = hit ? hit.distance : range;
          this.combat.laserDamage(aimDir, range, 38, dt, terrainDistance);
          if (hit) this.world.heatHit(hit, 2.7, 900 * dt, 110 * dt, 'laser');
        } else if (hit) {
          this.world.grindHit(hit, 2.2, 145 * dt);
        }

        if (hit && this.toolParticleTimer <= 0) {
          this.particles.emitMining(hit, this.ship.tool);
          this.toolParticleTimer = laser ? 0.045 : 0.07;
        }
      } else if (this.energyWarnCooldown <= 0) {
        this.ui.log('TOOL POWER LOW — ENERGY RECHARGING', 'warn');
        this.energyWarnCooldown = 2.2;
      }
    }

    if (this.laserActive && !wasActive) this.audio.play('laserStart');
    this.laserWasActive = this.laserActive;
  }

  handleWorldEvents() {
    for (const event of this.world.takeEvents()) {
      this.particles.handleEvent(event);
      if (ALTERING_EVENTS.has(event.type)) this.mission.alteredCells = Math.min(9999, this.mission.alteredCells + 1);
      switch (event.type) {
        case 'discover':
        case 'visit':
          this.ui.log(event.text, event.tone || '');
          this.audio.play('ui');
          break;
        case 'anomaly':
          this.ui.log(event.text, 'good');
          this.audio.play('trade');
          this.renderer.addShake(1.2);
          break;
        case 'touchdown':
          this.mission.landed = true;
          this.audio.play('touchdown');
          this.renderer.addShake(0.8);
          break;
        case 'impact':
          this.audio.play('impact', clamp((event.power || 10) / 28, 0.35, 1.5));
          this.renderer.addShake(clamp((event.power || 10) * 0.16, 0.5, 5));
          break;
        case 'shockwave':
          this.audio.play('explosion', clamp((event.power || 60) / 80, 0.5, 1.4));
          this.renderer.addShake(clamp((event.radius || 12) * 0.22, 1, 6));
          break;
        case 'cannon':
          this.audio.play('cannon');
          this.renderer.addShake(0.35);
          break;
        case 'enemyFire':
          this.audio.play('cannon', 0.28);
          break;
        case 'projectileImpact':
          this.audio.play('impact', 0.35);
          break;
        case 'enemyDestroyed':
          this.audio.play('explosion', 0.9);
          this.renderer.addShake(2.6);
          break;
        case 'collect':
          if (this.collectSoundCooldown <= 0) {
            this.audio.play('collect');
            this.collectSoundCooldown = 0.11;
          }
          break;
        case 'shipDamage':
          this.renderer.addShake(clamp((event.amount || 0) * 0.08, 0.2, 3));
          if ((event.amount || 0) > 8) this.audio.play('alarm');
          break;
        case 'trade':
          this.audio.play('trade');
          break;
        case 'alarm':
          this.audio.play('alarm');
          break;
        case 'ui':
          this.audio.play('ui');
          break;
        case 'launch':
          this.audio.play('ui');
          break;
        default:
          break;
      }
    }
  }

  handleShipNotifications() {
    for (const note of this.ship.takeNotifications()) {
      this.ui.log(note.text, note.tone || '');
      if (note.type === 'landing') this.mission.landed = true;
      if (note.type === 'sale' && this.mission.stage >= 2) {
        this.mission.sold = true;
        this.mission.soldUnits += note.units || 0;
      }
    }
  }

  advanceMission() {
    const completed = this.mission.stage;
    if (completed >= this.objectiveLabels.length) return;
    this.mission.stage++;
    this.objectiveText = this.objectiveTexts[this.mission.stage] || this.objectiveTexts[this.objectiveTexts.length - 1];
    const reward = this.objectiveRewards[completed] || 0;
    this.ship.credits += reward;
    this.ui.log(`OBJECTIVE COMPLETE · ${this.objectiveLabels[completed]}  +${reward} CR`, 'good');
    this.audio.play('trade');
  }

  updateMission() {
    const cargo = this.ship.cargoUsed();
    const delta = cargo - this.mission.prevCargo;
    if (delta > 0) this.mission.totalCollected += delta;
    this.mission.prevCargo = cargo;
    const cryo = this.world.anomalies.find((a) => a.id === 'cryo');
    switch (this.mission.stage) {
      case 0:
        if (this.mission.landed) this.advanceMission();
        break;
      case 1:
        if (this.mission.alteredCells > 20 && this.mission.totalCollected > 6) this.advanceMission();
        break;
      case 2:
        if (this.mission.sold && this.mission.soldUnits > 0) this.advanceMission();
        break;
      case 3:
        if (cryo?.found && this.combat.kills >= 2) this.advanceMission();
        break;
      default:
        break;
    }
  }

  checkRespawn() {
    if (this.ship.hull > 0 || this.respawnCooldown > 0) return;
    const station = this.world.bodyById.get('halcyon') || this.world.bodies[0];
    const lost = Math.floor(this.ship.credits * 0.12);
    this.ship.credits -= lost;
    for (const key of Object.keys(this.ship.cargo)) this.ship.cargo[key] *= 0.5;
    this.ship.respawnAt(station);
    this.respawnCooldown = 2.5;
    this.renderer.addShake(10);
    this.audio.play('explosion', 1.3);
    this.ui.log(`HULL LOSS · RECONSTRUCTED · -${lost} CR`, 'bad');
  }

  fixedUpdate(dt) {
    this.time += dt;
    this.energyWarnCooldown = Math.max(0, this.energyWarnCooldown - dt);
    this.collectSoundCooldown = Math.max(0, this.collectSoundCooldown - dt);
    this.respawnCooldown = Math.max(0, this.respawnCooldown - dt);

    this.ship.update(dt, this.input, this.world);
    this.updateTools(dt, this.aimDir);
    this.combat.update(dt);
    this.world.update(dt, this.ship);
    this.particles.update(dt, this.world, this.ship);
    this.ship.docked = this.world.findDock(this.ship);
    this.handleWorldEvents();
    this.handleShipNotifications();
    this.updateMission();
    this.checkRespawn();
  }

  loop(now) {
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = now;

    this.handleDiscreteInput();
    this.renderer.updateCamera(dt, this.ship, this.input);
    this.computeAim();

    if (!this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < 4) {
        this.fixedUpdate(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === 4) this.accumulator = 0;
    } else {
      this.beam.active = false;
      this.laserActive = false;
      this.laserWasActive = false;
    }

    this.trade.update(dt);
    this.audio.setThrust(this.paused ? 0 : this.ship.thrustLevel, this.ship.boosting);
    this.audio.setLaser(this.paused ? false : this.laserActive);
    this.ui.render(dt, this);
    this.renderer.render(this);
    this.input.endFrame();
    requestAnimationFrame(this.loop);
  }
}
