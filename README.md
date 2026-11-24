# PIXEL ORBIT — material spaceflight engine

A dependency-free 2D pixel graphics engine for a Newtonian space game. The world is a continuous, destructible material field: there is no orbit/surface scene split, no loading transition, and no separate “landing level.” You pilot from system scale down to individual terrain pixels with one continuous camera and one physical ship.

The core idea is that **every body is a grid of material pixels**. Monoliths have hit points and melting points, granular materials fall toward the local gravity well and fill gaps, liquids flow and displace lighter material, steam rises outward, magnetic grains respond to electromagnet nodes and the ship’s scoop, and unsupported solid components collapse into sand after their supports are removed.

## Run

```bash
npm start
```

Open `http://localhost:5173`. The included static server binds `0.0.0.0`, so it works inside the Arena live preview as well as locally. No build step, bundler, external assets, or runtime dependencies are required.

```bash
npm test
```

Runs headless tests for material rules, radial pixel gravity, phase changes, procedural generation, Newtonian flight, docking, raycasts and explosions.

## Flight and controls

| Input | Action |
| --- | --- |
| `W` / `S` or `↑` / `↓` | Main and reverse thrust |
| `A` / `D` or `←` / `→` | Manual torque |
| `Q` / `E` | Lateral RCS thrusters |
| `X` | Hold for counter-torque / attitude damping |
| `Shift` | Overthrust; more acceleration and fuel use |
| `V` | Toggle landing gear |
| `R` | Toggle magnetic scoop |
| `LMB` or `F` | Use selected tool toward the cursor |
| `RMB` or `Space` | Cannon |
| `1` / `2` / `3` | Grinder / laser / cannon |
| Mouse wheel, `Z` / `C` | Continuous zoom out / in |
| `0` | Return to altitude-based auto zoom |
| `B` | Gravity vector-field overlay |
| `Tab` | Survey map |
| `T` | Trade at a quiet, geared dock |
| `H` | Pilot reference |
| `P` | Pause |
| `M` | Mute |
| `Esc` | Close the active panel |

Momentum is never passively cancelled in vacuum. Gravity from all wells is integrated with a softened inverse-square field. Landing requires gear down, low vertical speed, low lateral drift, low angular rate, and alignment between the ship’s legs and the sampled surface normal. A safe touchdown creates a surface hold; thrusting manually lifts off again.

## Material simulation

Each `PixelBody` stores typed arrays for:

- `mat` — material id
- `hp` — monolith integrity
- `heat` — temperature / laser energy
- `tint` — deterministic per-pixel color variation
- `light` — cached directional lighting
- `dir` — one of eight directions toward the body’s gravity well
- `active` — sparse work queue of cells that need simulation

Only active or newly disturbed cells are simulated. Nearby bodies run at full cellular-automata rate; distant bodies are kept persistent at a reduced rate. Surface caches are updated through a dirty-cell set and blitted as nearest-neighbor `ImageData`.

### Phases

- **Void:** vacuum; transparent to rays and light.
- **Solid monoliths:** rock, ore, ice, hull alloy, glass, magnetite, electromagnet, lamp, dense core, exotic crystal. All have finite HP and can be ground into grains or melted. Dense core is merely very tough, not indestructible.
- **Granular:** regolith, ore dust, ice dust, metal sand, magnetite grains, exotic dust. These try the inward gravity direction, then its two diagonals, displacing lower-density liquid or gas.
- **Liquid:** water, fuel, molten rock, molten alloy. These flow inward and sideways, seek gaps, displace steam/water by density, and can flash water into steam when hot.
- **Gas:** steam. Moves outward against the radial gravity field, cools, condenses or dissipates.

### Heat, destruction and structure

- **Grinder:** reduces solid HP; at zero HP the cell becomes its `grindTo` granular form.
- **Laser:** adds heat and some damage. Ice melts to water, water vaporizes to steam, rock/alloy/ore/glass melt into flowing molten pixels. Molten material heats neighbors and cools back into a monolith.
- **Cannon:** explosive projectile; removes a crater, heats and damages nearby cells, scatters debris and damages drones.
- **Impacts:** high-speed ship contact grinds surface pixels and damages hull.
- **Structural solver:** after a monolith is broken, a flood fill from anchored core cells finds unsupported natural-rock components. Detached pieces crumble gradually into granular material. Space stations are explicitly unsupported structures, so their arms can remain in vacuum, but every station cell remains destructible.
- **Magnetism:** magnetite, metal scrap, exotic dust and electromagnet blocks carry magnetic properties. Station electromagnets attract magnetic grains; the ship scoop attracts magnetic debris from farther away and non-magnetic ore dust at close range. A market upgrade extends the scoop field.

## World

Six bodies and three anomalies are generated deterministically:

- **Selene** — airless moon with regolith, caves, ice pockets, ores, magnetite, dense core and a surface exchange pad.
- **Kestrel Shard** — irregular asteroid with an ore geode and low-gravity caves.
- **Vela** — volatile comet with ice, fuel pockets, sunward jets and a persistent parallax tail.
- **Halcyon Ring** — trading station with hub, ring, spokes, solar wings, docking pad and electromagnetic rails.
- **Cinder** — hot carbonaceous asteroid with molten pockets.
- **Vesper Foundry** — industrial station containing flowing molten alloy.

The renderer includes a procedural dithered nebula, parallax star layers, a distant sun glow, comet tails, emissive-cell bloom, landing lamps, gravity-field rings, map labels, velocity/gravity vectors, pixel ship and drone art, particles, laser beams and shockwaves. Camera zoom interpolates continuously from about `0.10×` system view to `3.2×` material-pixel view.

## Gameplay systems

- **Manual landing** on moon, stations, asteroids and comets through one continuous physics world.
- **Mining and cave exploration** with grinders, lasers, explosives, structural collapse and flowing materials.
- **Combat** with Newtonian hostile scouts/lancers, plasma projectiles, terrain destruction and salvage.
- **Trading** at lit docks: sell commodities, refuel, repair, expand cargo capacity and upgrade the magnetic amplifier.
- **Exploration** with survey discovery, anomalies, a system map and mission objectives.
- **Audio** synthesized with Web Audio; no audio files.

## Architecture

```text
index.html                 DOM HUD and canvas shell
styles.css                 pixel-terminal UI styling
server.mjs                 dependency-free static ES-module server
src/main.js                bootstrap
src/core/                  math, deterministic RNG/noise, input, audio
src/world/materials.js     material table, phases, colors, commodities
src/world/pixelBody.js     typed-array material grid, CA, heat, structure, caches
src/world/generation.js    procedural moon/asteroid/comet/station generators
src/world/world.js         gravity wells, raycasts, docking, discovery, explosions
src/game/ship.js           Newtonian ship, cargo, fuel, upgrades, metrics
src/game/physics.js        swept hull/terrain collision and landing resolution
src/game/combat.js         drones, projectiles, laser damage, salvage
src/game/particles.js      debris, steam, sparks, thrusters, shockwaves
src/game/trade.js          dock market and upgrades
src/game/game.js           fixed-step loop, tools, events, missions, respawn
src/render/background.js   procedural nebula and parallax stars
src/render/renderer.js     continuous camera, world rendering, HUD overlays
src/ui/hud.js              DOM telemetry, market, map, help and event log
tests/                     headless engine tests
```

The pure simulation modules deliberately avoid DOM dependencies, so the material engine can be tested in Node while browser-only render/UI modules stay separate.

## Extension points

- Add materials in `MATERIALS` with a phase, HP, melt/vapor thresholds, density, commodity and transition targets.
- Add body generators by extending `generateBody()`; every generator fills the same typed arrays.
- Tune local gravity through `g0`; it controls both Newtonian acceleration and cellular-automata tick rate.
- Add tools by raycasting through `World.raycast()` and calling `PixelBody` area methods.
- Replace the fixed sector with streaming chunks by retaining the same `PixelBody` interface and generating bodies/chunks on demand.

This repository is a playable vertical slice: single-sector, single-player, no save game and no networking. Its emphasis is the continuous material simulation and uninterrupted manual spaceflight loop.
