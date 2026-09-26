# Room looks

One JSON file per key room (`<room>.json`), loaded as-is by the renderer. The values come from the color and light script in the art direction (see `docs/art/README.md`).

| Field        | Type                                        | Meaning                                                                                                                                                                                                     |
| ------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | string                                      | Room id, same as the file name.                                                                                                                                                                             |
| `background` | `#rrggbb`                                   | Clear color behind all geometry.                                                                                                                                                                            |
| `exposure`   | number                                      | Tone mapping exposure (AgX). About 0.9–1.2.                                                                                                                                                                 |
| `hemi`       | `{ sky, ground, intensity }`                | HemisphereLight: sky and ground colors, intensity.                                                                                                                                                          |
| `fog`        | `{ color, density }`                        | FogExp2 (exponential squared). Density about 0.01–0.06.                                                                                                                                                     |
| `sun`        | `{ color, intensity, direction }` or `null` | DirectionalLight. `direction` is a vector pointing from the scene towards the light (y > 0 is overhead). `null` for rooms without daylight.                                                                 |
| `fire`       | `{ color, intensity, flicker }`             | Template for fire PointLights (decay 2). `intensity` is in candela (braziers 20–60); `flicker` is the 0–1 amplitude of the intensity noise. In `relic` it drives the Amber Heart's glow, with a slow pulse. |
| `bloom`      | `{ strength, radius, threshold }`           | Bloom pass. Keep the threshold high so only fire and relics bloom.                                                                                                                                          |
| `grade`      | `{ tint, saturation, contrast, vignette }`  | Final grade: multiplicative tint, saturation and contrast (1 = neutral), vignette strength 0–1.                                                                                                             |

All colors are sRGB hex strings; every number is a plain JSON number.
