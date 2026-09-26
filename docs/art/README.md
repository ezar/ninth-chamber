# Art direction

The art direction for The Ninth Chamber (La Novena Cámara) is a Claude Design canvas:

**https://claude.ai/artifact/S7g91RiXqGjJANNLXiYMfV**

It has six artboards: (a) art bible, (b) color and light script for The Antechamber, (c) material library, (d) Nora Vidal character sheet, (e) HUD and menus, (f) identity and key art. The engine look files built from the light script are in [`art/looks/`](../../art/looks/README.md).

## Palette

| Name         | Hex       | Use                                                     |
| ------------ | --------- | ------------------------------------------------------- |
| Tomb night   | `#0e0c0a` | Deepest shadow, backgrounds                             |
| Umber shadow | `#2a1f17` | Warm shadow                                             |
| Sandstone    | `#b8895a` | Main architecture                                       |
| Limestone    | `#cfc5b1` | Carvings, ledge lips                                    |
| Bone         | `#ece3d0` | Highlights, UI text                                     |
| Daylight     | `#a9bccb` | Cold overhead light                                     |
| Fog slate    | `#5b7280` | Cold fog, depth                                         |
| Verdigris    | `#5e7b68` | Oxidized bronze, interactive fittings                   |
| Ember        | `#e0772e` | Fire                                                    |
| Amber Heart  | `#f2a93b` | Relics and interaction hints only (5% max of any frame) |

No teal or turquoise anywhere, in the world or the UI.

## Materials

Base colors are sRGB albedo targets for choosing and tinting CC0 scans.

| Material        | Base color | Roughness | Metalness | Notes                                                                             |
| --------------- | ---------- | --------- | --------- | --------------------------------------------------------------------------------- |
| Sandstone       | `#b8895a`  | 0.88      | 0.00      | Hand-polished lips drop to 0.6; soot above braziers                               |
| Limestone       | `#cfc5b1`  | 0.80      | 0.00      | Grab lips polished to 0.55                                                        |
| Granite         | `#4a4744`  | 0.62      | 0.00      | Polished faces 0.35                                                               |
| Oxidized bronze | `#5e7b68`  | 0.65      | 0.35      | Worn spots `#a8773c`, metalness 1.0, roughness 0.35                               |
| Gold            | `#e8b75a`  | 0.25      | 1.00      | Recesses at roughness 0.6                                                         |
| Dry wood        | `#7a5e43`  | 0.90      | 0.00      | Sun-bleached tops `#a39277`                                                       |
| Still water     | `#1e2a2c`  | 0.04      | 0.00      | MeshPhysicalMaterial, transmission 0.9, IOR 1.333, attenuation `#2f4a44` at 1.5 m |
| Sand            | `#c8a77c`  | 0.95      | 0.00      | Drifts hide wall-to-floor joints                                                  |

## UI

- Fonts: Cormorant Garamond (display, small caps), Barlow (UI text), IBM Plex Mono (key caps, counters).
- Tokens: `--ui-ink #0f0d0b`, `--ui-veil rgba(12,10,8,0.72)`, `--ui-bone #ece3d0`, `--ui-dust #a89c88`, `--ui-line #3a3129`, `--ui-amber #e8a33d`, `--ui-ember #c8542b`, `--ui-lichen #8fa872`.
