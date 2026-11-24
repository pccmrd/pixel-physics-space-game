import { COMMODITIES } from '../world/materials.js';

export class TradeSystem {
  constructor(world, ship, ui) {
    this.world = world;
    this.ship = ship;
    this.ui = ui;
    this.open = false;
    this.dock = null;
    this.renderTimer = 0;
  }

  currentDock() {
    return this.world.findDock(this.ship);
  }

  tryOpen() {
    const dock = this.currentDock();
    if (!dock) {
      this.ui.log('NO EXCHANGE IN RANGE — APPROACH A LIT DOCKING PAD', 'warn');
      return false;
    }
    if (!dock.ready) {
      this.ui.log('DOCK REQUIRES GEAR DOWN AND RELATIVE SPEED BELOW 4.5 m/s', 'warn');
      return false;
    }
    this.open = true;
    this.dock = dock;
    this.ui.showTrade(true);
    this.ui.renderTrade(this);
    this.world.pushEvent({ type: 'ui', x: this.ship.x, y: this.ship.y });
    return true;
  }

  close(silent = false) {
    if (!this.open) return;
    this.open = false;
    this.ui.showTrade(false);
    if (!silent) this.ui.log('DOCK CLAMPS RELEASED', '');
  }

  toggle() {
    if (this.open) this.close();
    else this.tryOpen();
  }

  update(dt = 1 / 60) {
    if (!this.open) return;
    const dock = this.currentDock();
    if (!dock || !dock.ready) {
      this.close(true);
      this.ui.log('TRADE LINK LOST — LEFT DOCKING ENVELOPE', 'warn');
      return;
    }
    this.dock = dock;
    this.renderTimer -= dt;
    if (this.renderTimer <= 0) {
      this.ui.renderTrade(this);
      this.renderTimer = 0.18;
    }
  }

  commodities() {
    return Object.entries(COMMODITIES).map(([id, data]) => {
      const units = this.ship.cargo[id] || 0;
      const price = this.dock ? this.world.priceFor(this.dock.body, id) : data.price;
      return { id, ...data, units, price, value: Math.floor(units * price) };
    });
  }

  actions() {
    const ship = this.ship;
    const used = ship.cargoUsed();
    const fuelCost = Math.ceil((100 - ship.fuel) * 2.6);
    const repairCost = Math.ceil((100 - ship.hull) * 3.4);
    const holdCost = 350 + Math.max(0, ship.capacity - 100) * 8;
    const magnetCost = 420 + ship.magnetLevel * 260;
    const ore = ship.cargo.ore || 0;
    const volatiles = ship.cargo.volatiles || 0;
    const alloy = (ship.cargo.alloy || 0) + (ship.cargo.magnetite || 0);
    return [
      { id: 'sell-all', label: '1  SELL ALL CARGO', detail: `${used.toFixed(1)} u in hold`, enabled: used > 0.01 },
      { id: 'sell-ore', label: '2  SELL ORE', detail: `${ore.toFixed(1)} u · ${this.priceLabel('ore')}`, enabled: ore > 0.01 },
      { id: 'sell-volatiles', label: '3  SELL VOLATILES', detail: `${volatiles.toFixed(1)} u · ${this.priceLabel('volatiles')}`, enabled: volatiles > 0.01 },
      { id: 'sell-alloy', label: '4  SELL ALLOY / MAGNETITE', detail: `${alloy.toFixed(1)} u`, enabled: alloy > 0.01 },
      { id: 'refuel', label: '5  REFUEL TANKS', detail: `${fuelCost} CR`, enabled: ship.fuel < 99.5 && ship.credits >= fuelCost },
      { id: 'repair', label: '6  REPAIR HULL', detail: `${repairCost} CR`, enabled: ship.hull < 99.5 && ship.credits >= repairCost },
      { id: 'upgrade-hold', label: '7  EXPAND CARGO HOLD', detail: `${holdCost} CR · +25 u`, enabled: ship.capacity < 175 && ship.credits >= holdCost },
      { id: 'upgrade-magnet', label: '8  MAGNETIC AMPLIFIER', detail: `${magnetCost} CR · level ${ship.magnetLevel}/3`, enabled: ship.magnetLevel < 3 && ship.credits >= magnetCost }
    ];
  }

  priceLabel(commodity) {
    return this.dock ? `${this.world.priceFor(this.dock.body, commodity)} CR/u` : '—';
  }

  getMarketData() {
    const dock = this.currentDock() || this.dock;
    return {
      dock,
      commodities: this.commodities(),
      actions: this.actions(),
      credits: this.ship.credits,
      integrity: dock?.body.integrity() ?? 1
    };
  }

  actionIndex(index) {
    const action = this.actions()[index];
    if (!action || !action.enabled) {
      this.ui.log('TRANSACTION UNAVAILABLE', 'warn');
      return false;
    }
    return this.action(action.id);
  }

  complete(text, tone = 'good', meta = {}) {
    this.ui.log(text, tone);
    this.ship.notify(text, tone, meta);
    this.world.pushEvent({ type: 'trade', x: this.ship.x, y: this.ship.y });
    this.ui.renderTrade(this);
    return true;
  }

  sellCommodity(commodity) {
    const price = this.world.priceFor(this.dock.body, commodity);
    const result = this.ship.sellCargo(commodity, price);
    if (!result) {
      this.ui.log('NO SUCH CARGO IN HOLD', 'warn');
      return false;
    }
    const name = COMMODITIES[commodity].name;
    return this.complete(`SOLD ${result.units.toFixed(1)} u ${name}  +${result.revenue} CR`, 'good', { type: 'sale', commodity, units: result.units, revenue: result.revenue });
  }

  sellAll() {
    const dock = this.dock;
    if (!dock) return false;
    let revenue = 0;
    let units = 0;
    for (const key of Object.keys(this.ship.cargo)) {
      const amount = this.ship.cargo[key] || 0;
      if (amount <= 0) continue;
      const price = this.world.priceFor(dock.body, key);
      revenue += Math.floor(amount * price);
      units += amount;
      this.ship.cargo[key] = 0;
    }
    if (units <= 0) {
      this.ui.log('HOLD IS EMPTY', 'warn');
      return false;
    }
    this.ship.credits += revenue;
    return this.complete(`SOLD ${units.toFixed(1)} u CARGO  +${revenue} CR`, 'good', { type: 'sale', commodity: 'all', units, revenue });
  }

  action(id) {
    if (!this.open) return false;
    const dock = this.currentDock();
    if (!dock || !dock.ready) {
      this.close(true);
      return false;
    }
    this.dock = dock;
    const ship = this.ship;
    switch (id) {
      case 'sell-all':
        return this.sellAll();
      case 'sell-ore':
        return this.sellCommodity('ore');
      case 'sell-volatiles':
        return this.sellCommodity('volatiles');
      case 'sell-alloy': {
        const a = this.ship.sellCargo('alloy', this.world.priceFor(dock.body, 'alloy'));
        const m = this.ship.sellCargo('magnetite', this.world.priceFor(dock.body, 'magnetite'));
        const revenue = (a?.revenue || 0) + (m?.revenue || 0);
        const units = (a?.units || 0) + (m?.units || 0);
        if (units <= 0) {
          this.ui.log('NO ALLOY OR MAGNETITE IN HOLD', 'warn');
          return false;
        }
        return this.complete(`SOLD ${units.toFixed(1)} u INDUSTRIAL MATERIAL  +${revenue} CR`, 'good', { type: 'sale', commodity: 'alloy', units, revenue });
      }
      case 'refuel': {
        const cost = Math.ceil((100 - ship.fuel) * 2.6);
        if (!ship.spendCredits(cost)) return false;
        ship.refuel(100);
        return this.complete(`TANKS REFILLED  -${cost} CR`, 'good', { type: 'refuel' });
      }
      case 'repair': {
        const cost = Math.ceil((100 - ship.hull) * 3.4);
        if (!ship.spendCredits(cost)) return false;
        ship.repair(100);
        return this.complete(`HULL PLATES REPLACED  -${cost} CR`, 'good', { type: 'repair' });
      }
      case 'upgrade-hold': {
        const cost = 350 + Math.max(0, ship.capacity - 100) * 8;
        if (!ship.spendCredits(cost)) return false;
        ship.capacity += 25;
        return this.complete(`CARGO HOLD EXPANDED TO ${ship.capacity} u  -${cost} CR`, 'good', { type: 'upgrade' });
      }
      case 'upgrade-magnet': {
        const cost = 420 + ship.magnetLevel * 260;
        if (!ship.spendCredits(cost)) return false;
        ship.magnetLevel++;
        ship.scoopRangeBonus += 24;
        return this.complete(`MAGNETIC AMPLIFIER LEVEL ${ship.magnetLevel}  -${cost} CR`, 'good', { type: 'upgrade' });
      }
      default:
        return false;
    }
  }
}
