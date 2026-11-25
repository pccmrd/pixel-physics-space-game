# PIXEL ORBIT — material spaceflight engine

A dependency-free 2D pixel graphics engine for a Newtonian space game. The world is a continuous, destructible material field: there is no orbit/surface scene split, no loading transition, and no separate “landing level.” You pilot from the scale of a lunar-orbit belt down to individual terrain pixels with one continuous camera and one physical ship.

The core idea is that **every landable body is a grid of material pixels**. Monoliths have hit points and melting points, granular materials fall toward the local gravity well and fill gaps, liquids flow and displace lighter material, steam rises outward, magnetic grains respond to electromagnet nodes and the ship’s scoop, and unsupported solid components collapse into sand after their supports are removed.

## Run

```bash
npm start
```

Open `http://localhost:5173`. The included static server binds `0.0.0.0`, so it works inside the Arena live preview as well as locally. No build step, bundler, external assets, or runtime dependencies are required.

```bash
npm test
```

Runs headless tests for material rules, weak density-based gravity, radial pixel flow, phase changes, procedural generation, pad clamping, Newtonian flight, scanning, orbit hold, EVA, streaming and continuous docking.

## Setting: Luna orbit, 2035

The game does **not** go to the Moon’s surface. Luna is rendered as a distant no-landing landmark and a soft exclusion zone. The playable region is a broad orbital belt around it, populated in the year 2035 by hundreds of hauled asteroids and comet cores. Automatic haulers keep delivering fresh bodies from around the Solar System. On arrival, **320 bodies are tracked and 304 — exactly 95% — are uncatalogued**. Distant bodies are lightweight continuous signatures; when the ship approaches one, its full pixel-material body is generated and joined to the same uninterrupted simulation. Bodies materialize and deactivate without scene changes while their mined/destroyed state stays cached.

Several featured bodies are deliberately huge, with cave systems, mineral seams, cave biomes, crashed derelicts and weak local gravity. The ship and its landing gear are also larger and more detailed than a simple 2D marker.

## Flight and controls

| Input | Action |
| --- | --- |
| `W` / `S` or `↑` / `↓` | Main and reverse thrust |
| `A` / `D` or `←` / `→` | Manual torque |
| `Q` / `E` | Lateral RCS thrusters |
| `U` / `J` | Burn outward / inward across lunar orbital lanes |
| `X` | Hold for counter-torque / attitude damping |
| `Shift` | Overthrust; more acceleration and fuel use |
| `V` | Toggle landing gear; gear up also releases pad clamps |
| `R` | Toggle magnetic scoop |
| `LMB` or `F` | Use selected tool toward the cursor; on EVA, sample cave material |
| `RMB` or `Space` | Cannon |
| `1` / `2` / `3` | Grinder / laser / cannon |
| `N` | Scan nearby uncatalogued masses |
| `O` | Toggle a slow orbit hold around the nearest asteroid or comet |
| `G` | Deploy / return an EVA suit while in range of caves |
| `L` | Release electromagnetic pad clamps |
| Mouse wheel, `Z` / `C` | Continuous zoom out / in |
| `0` | Return to altitude-based auto zoom |
| `B` | Gravity vector-field overlay |
| `Tab` | Survey map |
| `T` | Trade at a quiet, geared dock |
| `H` | Pilot reference |
| `P` | Pause |
| `M` | Mute |
| `Esc` | Close the active panel; close trade and release clamps |

Momentum is never passively cancelled in vacuum. Gravity is density-based: surface acceleration scales with the radius of each small rubble pile, so asteroids and comet cores have gentle wells rather than lunar-strength wells. A softened inverse-square field sums all tracked bodies; the total is capped to keep distant wells weak.

Landing still requires gear down, low vertical speed, low lateral drift, low angular rate and alignment between the ship’s legs and the sampled surface normal. A precise landing inside a lit exchange pad engages **electromagnetic clamps**. While clamped, the ship is kinematically held at the pad’s exact local coordinates, follows the station’s orbital motion, and keeps the market link ready; it cannot bounce in and out of the docking window. `L`, raising gear, or closing the trade panel releases the clamps. Ordinary surface holds still lift off with manual thrust.

## Scan, capture, scavenge, explore

- `N` emits a survey pulse, catalogues nearby unknown signatures and reports composition, minerals, substances, cave biomes and crashed derelicts.
- `O` engages a slow orbit hold around a nearby asteroid or comet. Any manual thrust input releases it. The hold is an assist, not a scene transition.
- `G` deploys an EVA tether from a slow orbit or a landed asteroid. The suit uses `W`/`S`/`Q`/`E`, is constrained by a tether, collides with material pixels, and can enter caves too small for the ship.
- EVA cave contact can recover biome samples, exotic cargo and derelict salvage. Mining tools work from the suit at short range.
- Automatic haulers tow new uncatalogued bodies into the belt over time and emit delivery events without pausing play.
- Destructible pixel bodies are cached after materialization, preserving ground caves and melt channels when the camera moves away.

## Material simulation

Each `PixelBody` stores typed arrays for:

- `mat` — material id
- `hp` — monolith integrity
- `heat` — temperature / laser energy
- `tint` — deterministic per-pixel color variation
- `light` — cached directional lighting
- `dir` — one of eight directions toward the body’s gravity well
- `active` — sparse work queue of cells that need simulation

Only active or newly disturbed cells are simulated. Nearby bodies run at full cellular-automata rate; distant active bodies are kept persistent at a reduced rate. Surface caches are updated through a dirty-cell set and blitted as nearest-neighbor `ImageData`.

### Phases

- **Void:** vacuum; transparent to rays and light.
- **Solid monoliths:** rock, ore, ice, hull alloy, glass, magnetite, electromagnet, lamp, dense core, exotic crystal and cave biomass. All have finite HP and can be ground into grains or melted. Dense core is merely very tough, not indestructible.
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

## World and rendering

Featured locations include **Selene Gate**, **Halcyon Ring**, **Vesper Foundry**, **Kestrel Shard**, **Goliath**, **Vela** and **Cinder**. They are stations, giant asteroids and comet cores with exchange pads, cave biomes, ores, magnetic seams, cryo volatiles, molten pockets, crashed derelicts and destructible structures. Hundreds of lower-detail orbital signatures surround them, with deterministic seeds used to materialize full pixel bodies on approach.

The renderer includes a procedural dithered nebula, parallax star layers, a distant sun glow, a large lunar crescent, dashed orbital lanes, automatic haulers and tow cables, comet tails, emissive-cell bloom, landing lamps, gravity-field rings, map labels, velocity/gravity vectors, a larger pixel ship, EVA suit and tether, particles, laser beams and shockwaves. Camera zoom interpolates continuously from about `0.10×` belt view to `3.2×` material-pixel view.

## Gameplay systems

- **Manual uninterrupted landing** on stations, asteroids and comets through one continuous physics world; no Moon-surface level.
- **Stable pad clamping** with an explicit release mechanism and hysteresis for the market link.
- **Mining, melting, grinding and cave exploration** with flowing materials and structural collapse.
- **Scanning and catalogue** of an initially 95%-uncatalogued orbital population.
- **Capture, scavenge and EVA** into cave biomes and crashed derelicts.
- **Combat** with Newtonian hostile scouts/lancers, plasma projectiles, terrain destruction and salvage.
- **Trading** at lit docks: sell commodities, refuel, repair, expand cargo capacity and upgrade the magnetic amplifier.
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
src/world/generation.js    asteroid/comet/station/cave/derelict generators
src/world/world.js         lunar belt, haulers, streaming, gravity, docking, scans
src/game/ship.js           Newtonian ship, clamps, orbit hold, EVA, cargo, metrics
src/game/physics.js        swept hull/terrain collision and landing resolution
src/game/combat.js         drones, projectiles, laser damage, salvage
src/game/particles.js      debris, steam, sparks, thrusters, shockwaves
src/game/trade.js          dock market and upgrades
src/game/game.js           fixed-step loop, tools, events, missions, respawn
src/render/background.js   procedural nebula, stars and distant Luna
src/render/renderer.js     continuous camera, belt/proxy/hauler/body rendering
src/ui/hud.js              DOM telemetry, market, map, help and event log
tests/                     headless engine tests
```

The pure simulation modules deliberately avoid DOM dependencies, so the material engine can be tested in Node while browser-only render/UI modules stay separate.

## Extension points

- Add materials in `MATERIALS` with a phase, HP, melt/vapor thresholds, density, commodity and transition targets.
- Add body generators by extending `generateBody()`; every generator fills the same typed arrays.
- Tune local gravity through `density`; it controls both Newtonian surface acceleration and cellular-automata tick rate.
- Add tools by raycasting through `World.raycast()` and calling `PixelBody` area methods.
- Extend the orbital catalogue, survey findings or hauler delivery cadence in `World`.
- Replace lightweight proxies with even richer streaming by retaining the same `PixelBody` interface.

This repository is a playable vertical slice: single-sector, single-player, no save game and no networking. Its emphasis is the continuous material simulation, stable manual docking and an uninterrupted lunar-orbit exploration loop.
