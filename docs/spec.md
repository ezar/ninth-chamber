# La Novena Cámara (The Ninth Chamber) · Spec de juego

Sep 26, 2026 · @César

## 1. Visión y pilares

La Novena Cámara (The Ninth Chamber) es una aventura de exploración de tumbas en tercera persona, inspirada en los clásicos de 1996 a 2000, que se juega en el navegador (PC, móvil y mando). Nora Vidal, arqueóloga, recorre tumbas selladas resolviendo puzles de bloques y mecanismos, sorteando trampas y enfrentándose a guardianes. El PoC ya valida el núcleo: rejilla de bloques, salto, agarre, bloques, palanca, trampas y enemigos.

**El gancho:** las tumbas de esta civilización tienen ocho cámaras conocidas y una novena que nadie ha encontrado. Cada nivel es una cámara, y cada reliquia recuperada revela una pista hacia la novena, que es el nivel final. La tumba de Qarrum, la del PoC, pasa a ser la primera cámara. El título en castellano es "La Novena Cámara", en inglés "The Ninth Chamber", y el repo es `ninth-chamber`. Antes de publicar hay que comprobar que el nombre no está registrado como marca.

Este documento es la fuente de verdad para construir el juego con Claude Code (código) y Claude Design (dirección de arte e interfaz). Todo lo que no esté aquí se decide en el código y se anota en la sección de decisiones.

### Pilares

1. **Movimiento preciso y legible.** El mundo está hecho de bloques de 2 m y alturas en pasos de 0,5 m (un "click", un cuarto de bloque). El jugador aprende que un salto con carrerilla cubre exactamente 2 bloques y que un saliente de 1 bloque se alcanza agarrándose. Nada de física emergente que rompa esa promesa.
2. **El nivel es el puzle.** La dificultad viene de leer la arquitectura: dónde agarrarse, qué bloque mover, qué palanca abre qué. El combate es un condimento, no el plato.
3. **Belleza que obliga a detenerse.** Realismo cinematográfico dirigido por Claude Design: cada cámara tiene al menos una vista que el jugador querrá capturar. La rejilla manda en la colisión, nunca en lo que se ve.
4. **Soledad y asombro.** Silencio, luz de braseros, salas enormes que se revelan poco a poco. Pocos enemigos y muy marcados.
5. **Justo con el jugador.** Toda trampa se anuncia (sonido, grieta, marca en el suelo). Puntos de control generosos y guardado libre en PC.
6. **Hecho de datos.** Niveles, looks de iluminación, enemigos, objetos y textos viven en JSON editables. Crear una sala nueva no debe requerir tocar código.

### Qué no es

- No es un mundo abierto ni tiene generación procedural de niveles.
- No usa motor de física genérico (nada de Rapier o Cannon para el personaje): la colisión es de rejilla, determinista.
- No reutiliza nombres, personajes, diseños ni sonidos de Tomb Raider. Protagonista, mundo, tumbas y logotipo son propios.
- No es multijugador.

### Público y plataformas

- Adultos que jugaron los clásicos y quieren esa sensación sin emulador, y jugadores nuevos de puzles de plataformas.
- Navegadores de escritorio con teclado y ratón o mando, y móviles modernos (iPhone 12 o superior, Android gama media de 2022) con controles táctiles.
- Instalable como PWA y jugable sin conexión.

## 2. Alcance por fases

Cuatro fases, cada una con una puerta de salida medible. No se empieza una fase sin cerrar la puerta de la anterior.

### Fase 0 · PoC (hecho)

- Un único HTML con Three.js r128, rejilla de 2 m, 4 salas, jugable en escritorio y móvil.
- Valida: correr, andar, salto parado y con carrerilla, agarre, desplazamiento colgado, trepar, empujar y arrastrar bloque, palanca, placa, losas que caen, foso de estacas, 2 chacales, apuntado automático, secreto, puntos de control.
- Sirve de referencia de sensaciones: las constantes del apéndice del controlador salen de aquí.

### Fase 1 · Base técnica y vertical slice (4 a 6 semanas)

- Repo `ninth-chamber` con Vite, TypeScript y Three.js actual; el PoC portado a módulos sin perder sensaciones.
- Formato de nivel JSON v1, cargador y editor de rejilla mínimo.
- Controlador completo de la sección 5 (incluye salto hacia atrás y lateral, rodar, bajar a colgar, pendientes, escalar paredes y nadar).
- Primer nivel "La Antesala" (10 a 14 salas, 15 a 20 minutos) con el look de luz y materiales de Claude Design aplicado y personaje provisional.
- **Puerta:** 5 personas juegan el nivel entero sin ayuda; ninguna se queja de controles "injustos"; 60 fps en calidad media en un portátil con gráfica integrada y 30 fps o más en un iPhone 12; Claude Design aprueba la sala de muestra.

### Fase 2 · Alpha con 3 niveles (8 a 10 semanas)

- Dirección de arte cerrada en Claude Design y aplicada: texturas, personaje, enemigos, HUD, menús.
- Niveles: La Antesala, Las Cisternas (agua y buceo), El Templo del Sol (mecanismos grandes y un jefe).
- Inventario, llaves y reliquias, guardado, opciones, remapeo de controles, audio completo.
- **Puerta:** los 3 niveles se completan de principio a fin; todos los secretos son alcanzables; tests de movimiento en verde.

### Fase 3 · Beta y publicación (4 a 6 semanas)

- Pulido de animación e iluminación, accesibilidad, localización ES/EN/CA.
- PWA instalable, sin conexión, publicada en Vercel o Netlify desde el repo.
- **Puerta:** cero bloqueos conocidos (quedarse atascado sin salida), tiempo de carga inicial por debajo de 4 s en 4G.

### Fuera de alcance por ahora

- Vehículos, cuerdas y lianas, sistema de cuerdas de balanceo (candidato a fase 4).
- Cinemáticas con voces.
- Editor de niveles para el público.

## 3. Arquitectura técnica

TypeScript estricto sobre Three.js, con la simulación separada del render y un bucle de paso fijo a 60 Hz. La simulación no importa nada de Three.js: así se puede testear en Node y grabar repeticiones deterministas.

### Stack

- **Lenguaje y build:** TypeScript 5 (strict), Vite, pnpm.
- **Render:** Three.js (última estable), WebGPURenderer con caída automática a WebGL2; PBR, lightmaps y postproceso según la sección 11.
- **Modelos y animación:** glTF 2.0 (.glb) con compresión Meshopt; texturas KTX2 (Basis) generadas en el build.
- **Audio:** Web Audio API propia, sin librería (mezclador con buses música, ambiente, efectos, UI).
- **UI:** HTML y CSS encima del canvas, sin framework; Preact solo si los menús crecen.
- **Tests:** Vitest para simulación, Playwright para humo en navegador.
- **Calidad:** ESLint, Prettier, CI en GitHub Actions (tests + build + despliegue de previsualización).

### Estructura del repo

```text
ninth-chamber/
  CLAUDE.md                 reglas para Claude Code
  docs/spec.md              este documento exportado
  src/
    core/                   bucle fijo, input, eventos, rng con semilla
    sim/                    SIN Three.js: rejilla, colisión, personaje, enemigos, mecanismos
      grid/                 Level, Sector, consultas de altura y suelo
      player/               máquina de estados y un archivo por estado
      actors/               enemigos, bloques, trampas, pickups
      logic/                triggers, acciones, flags (sistema de eventos)
    render/                 construcción de mallas del nivel, actores, luces, postproceso
    anim/                   mezclador de clips, IK de manos y pies
    camera/                 cámara orbital, colisión, cámaras fijas por zona
    audio/                  mezclador, eventos de sonido, reverb por sala
    ui/                     HUD, menús, inventario circular, controles táctiles
    save/                   guardado en IndexedDB, versiones de esquema
    editor/                 editor de niveles (solo en modo dev)
  levels/                   *.level.json + scripts de validación
  assets/                   glb, texturas fuente, audio fuente
  tests/                    tests de movimiento y repeticiones grabadas
```

### Bucle y capas

- **Paso fijo:** la simulación avanza en ticks de 1/60 s con acumulador; el render interpola entre el estado anterior y el actual. Máximo 5 ticks por frame para no entrar en espiral.
- **Input como datos:** cada tick recibe un `InputFrame` (ejes, botones pulsados, mantenidos y soltados). Grabar la lista de `InputFrame` es grabar una partida.
- **Estado único:** `World` contiene rejilla, actores, flags y temporizadores. Serializable a JSON para guardar y para tests.
- **Eventos:** la simulación emite eventos (`player.jumped`, `door.opened`, `enemy.hit`) que consumen render, audio y UI. La simulación nunca llama a audio o render directamente.
- **Aleatoriedad:** un solo RNG con semilla en `World`; prohibido `Math.random()` en `sim/`.

### Rendimiento objetivo

- Calidad alta: 60 fps a 1440p con GPU dedicada (RTX 3060 o equivalente). Calidad media: 60 fps a 1080p con gráfica integrada (Intel Iris Xe). Calidad móvil: de 30 a 60 fps en iPhone 12.
- Menos de 400 draw calls en alto y 150 en móvil: la geometría estática de cada sala se fusiona por material y las piezas del kit se instancian.
- Primer nivel con menos de 60 MB en calidad alta y 25 MB en móvil, cargado por salas; la primera sala jugable en menos de 8 s.

## 4. Mundo en rejilla

El nivel es un conjunto de salas; cada sala es una rejilla de sectores de 2 × 2 m con suelo y techo propios. Las salas se conectan por portales, lo que permite salas encima de otras (puentes, pisos, pozos) sin salir del modelo de rejilla.

### Unidades

- **Bloque:** 2 m de lado. Es la unidad de diseño: un salto con carrerilla cruza 2 bloques de hueco, uno parado cruza 1.
- **Click:** 0,5 m, un cuarto de bloque. Todas las alturas de suelo y techo son múltiplos de un click.
- **Reglas que el jugador aprende:** 1 click se sube andando; 2 clicks (1 m) se suben saltando; de 3 a 7 clicks hay que agarrarse; 8 clicks o más es pared. Una caída de más de 3,5 m hace daño y de más de 6,5 m mata.

### Sector

Cada sector guarda:

- `floor`: altura en clicks de sus 4 esquinas (NO, NE, SE, SO). Si son iguales es plano; si difieren es pendiente. Diferencia de 1 click entre esquinas es rampa andable; de 2 o más, pendiente resbaladiza.
- `ceil`: altura del techo en clicks, también por esquinas. Si `ceil - floor` es menor de 4 clicks, Nora pasa agachada (fase 2) o no pasa.
- `wall`: `true` si es macizo.
- `mat`: material para texturas y sonido de pisadas (`sand`, `stone`, `metal`, `wood`, `water`).
- `flags`: `climbN`, `climbE`, `climbS`, `climbW` (pared escalable en ese lado), `death` (estacas, lava), `crumble`, `noGrab`.
- `trigger`: id opcional de un trigger (sección 8).
- `water`: altura de la superficie del agua en clicks, si la hay.

### Sala

- `id`, `origin` (posición en bloques en el mundo), `size` (ancho y fondo en bloques), `sectors` (matriz), `portals` (sectores que conectan con otra sala), `ambient` (color y niebla), `reverb` (preset de sonido), `music` (pista opcional).
- La colisión consulta la sala actual y, en los bordes con portal, la sala vecina. Un actor siempre sabe en qué sala está.

### Formato de archivo

Un nivel es un `*.level.json` validado con un esquema (Zod) en el build. Para que se pueda editar a mano y revisar en diffs, los sectores se escriben como filas de texto con una leyenda, igual que en el PoC, y las excepciones (pendientes, flags, triggers) aparte.

```json
{
  "schema": 1,
  "id": "antesala",
  "name": { "es": "La Antesala", "en": "The Antechamber" },
  "start": { "room": "entrada", "x": 3, "z": 6, "face": "E" },
  "rooms": [
    {
      "id": "entrada",
      "origin": [0, 0, 0],
      "ceil": 16,
      "legend": { "#": "wall", ".": 0, "a": 2, "b": 8, "_": "pit" },
      "rows": [
        "##########",
        "#........#",
        "#..ab....#",
        "#........D",
        "##########"
      ],
      "overrides": [
        { "at": [6, 1], "floor": [0, 1, 1, 0] },
        { "at": [8, 1], "flags": ["climbE"] }
      ],
      "portals": [{ "at": [9, 3], "to": "foso" }],
      "ambient": { "color": "#2a1f14", "fog": [6, 30] },
      "reverb": "stone_medium"
    }
  ],
  "entities": [
    { "id": "palanca1", "type": "lever", "room": "entrada", "at": [8, 2], "wall": "E" },
    { "id": "puerta1", "type": "door", "room": "entrada", "at": [9, 3], "height": 14 },
    { "id": "idolo1", "type": "secret", "room": "entrada", "at": [4, 2] }
  ],
  "logic": [
    { "when": "palanca1.used", "do": ["puerta1.open", "camera.focus puerta1 2s", "sfx rumble"] }
  ]
}
```

### Consultas que ofrece `sim/grid`

- `floorAt(x, z, room)` con interpolación en pendientes y la normal del suelo.
- `ceilAt(x, z, room)`.
- `sectorAt(x, z, room)` y `neighbour(sector, dir)` cruzando portales.
- `ledgeAt(pos, dir, handHeight)`: devuelve el borde agarrable más cercano (altura, línea del borde y normal) o nada.
- `raycast(from, to)`: para línea de visión de enemigos, apuntado y colisión de cámara.
- `sweepCircle(pos, radius, delta, stepUp)`: movimiento con colisión por columnas y filas, como en el PoC, extendido a pendientes y techos.

### Objetos dinámicos en la rejilla

Puertas, bloques empujables, plataformas móviles y losas que caen modifican la altura efectiva de su sector mientras existen. Se registran en un mapa de ocupación por sector y la consulta de altura suma su aportación, como hacía `cellH` en el PoC.

## 5. Controlador del personaje

Nora es una máquina de estados explícita: un archivo por estado en `sim/player/`, cada uno con `enter`, `tick` y `exit`, y una tabla de transiciones que se puede testear sin render. Las animaciones siguen al estado; nunca al revés.

&#91;embedded content: estados del personaje y transiciones principales\]

Desde Deslizar se puede saltar (pasa a Aire) y al acabar la pendiente vuelve a Suelo. Desde Superficie del agua se sale trepando a un borde de hasta 1 click sobre el agua.

### Movimientos

1. **Correr y andar.** Correr por defecto; andar (Shift, gatillo izquierdo) nunca cae por un borde de más de 1 click.
2. **Saltos.** Parado vertical; hacia delante (1 bloque); con carrerilla (2 bloques de hueco); hacia atrás y laterales (1 bloque, sin girar). El salto con carrerilla necesita al menos 0,4 s corriendo.
3. **Agarre.** En el aire, con Acción mantenida, se agarra a un borde si las manos quedan entre 0,45 m por debajo y 0,35 m por encima de él y está a menos de 0,5 m. También al subir.
4. **Colgada.** Desplazamiento lateral si el borde continúa; trepar con adelante o salto; soltarse con atrás o Acción. Esquinas interiores y exteriores (fase 2).
5. **Bajar a colgar.** Andando hacia atrás hasta el borde con Acción mantenida, Nora se descuelga y queda colgada.
6. **Rodar.** Giro de 180° rápido (Q, botón B), también en el agua.
7. **Bloques.** Agarre con Acción de cara al bloque; adelante empuja, atrás tira. Un bloque por pulsación, siempre de sector a sector.
8. **Escalar paredes.** En caras marcadas `climb`: arriba, abajo y lados; saltar hacia atrás desde la pared.
9. **Pendientes.** Con 2 o más clicks de desnivel entre esquinas, Nora desliza y solo puede saltar.
10. **Agua.** Nado en superficie, buceo con barra de aire de 60 s y 10 puntos de daño por segundo al agotarse; salto al agua sin daño desde cualquier altura si el agua cubre 2 clicks o más.
11. **Interactuar.** Palancas, cerraduras, recoger objetos (animación de agacharse), colocar objetos en huecos.
12. **Agacharse y gatear** en pasos de menos de 2 m de alto (fase 2).

### Esquemas de control

- **Relativo a cámara** (por defecto): el stick mueve respecto a la cámara, como el PoC.
- **Clásico tipo tanque** (opcional): arriba avanza, los lados giran. Los puristas lo pedirán y la máquina de estados no cambia, solo el mapeo del input.

### Ayudas (activadas por defecto, desactivables en "modo clásico")

- Tiempo de coyote de 0,1 s tras salir de un borde.
- Buffer de salto de 0,12 s antes de tocar suelo.
- Alineado de salto: al saltar a menos de 0,3 m de un borde, se corrige la dirección hasta 10° para caer recta.
- Auto-agarre: si se salta hacia un borde agarrable, se agarra sin mantener Acción.

### Constantes de partida (del PoC)

- Radio de colisión 0,34 m, altura 1,9 m, subida automática de escalón hasta 0,55 m.
- Correr 5,4 m/s, andar 2,2 m/s, aceleración 12 por segundo.
- Gravedad 24 m/s², velocidad de salto 8,05 m/s: altura 1,35 m, 0,67 s en el aire, 3,6 m de alcance corriendo.
- Control aéreo 3 m/s², velocidad horizontal máxima en el aire 5,6 m/s.
- Manos a 2,0 m sobre los pies al colgar; desplazamiento colgada 1,4 m/s; trepar 0,8 s.
- Empujar 0,9 s por bloque; tirar 1,0 s.
- Daño por caída desde 3,5 m, 26 puntos por metro extra; muerte desde 6,5 m.

Todas viven en `sim/player/tuning.ts` y se pueden ajustar en caliente desde un panel de depuración (tecla F1 en modo dev).

## 6. Cámara

Cámara orbital en tercera persona controlada por el jugador, con colisión contra la rejilla y cámaras fijas que el nivel puede imponer en momentos concretos. La cámara nunca atraviesa paredes ni deja a Nora fuera de plano.

### Cámara libre (por defecto)

- Órbita alrededor de un punto 1,45 m sobre los pies de Nora (1,7 m al colgar). Distancia 5,6 m, entre 3 y 9 con zoom.
- Giro con ratón arrastrando o con bloqueo de puntero opcional, stick derecho del mando, o arrastre en la mitad derecha de la pantalla táctil.
- Inclinación entre -14° y 66°.
- Seguimiento suave (constante 10 por segundo); recentrar detrás de Nora con C o pulsando el stick derecho.
- Al colgar, la cámara gira sola detrás de Nora para ver el borde y lo que hay encima.

### Colisión

- Rayo desde el objetivo a la posición deseada contra la rejilla y los techos, con un radio de 0,25 m; si choca, la cámara se acerca hasta el impacto.
- Si la cámara queda a menos de 1,2 m, Nora se vuelve semitransparente para no tapar la vista.
- Recuperación lenta de la distancia (0,5 s) para que no dé tirones al pasar junto a columnas.

### Cámaras del nivel

El nivel puede declarar cámaras en su lógica. Tipos:

- `focus`: mira un punto durante N segundos (se abre una puerta lejos; el PoC solo lo anunciaba con texto).
- `fixed`: posición fija mientras Nora esté en un volumen (pasillos estrechos, sala de jefe).
- `rail`: sigue un raíl mientras Nora avanza (persecución de la roca rodante).
- Toda cámara de nivel se puede saltar con cualquier botón tras 0,5 s.

### Apuntado

- Con el arma lista, la cámara se desplaza 0,5 m sobre el hombro derecho y se acerca a 4 m.
- Marca sutil sobre el enemigo fijado; cambiar de objetivo con el stick derecho o Tab.

## 7. Combate y enemigos

Combate sencillo con apuntado automático: la tensión viene de dónde estás, no de la puntería. Nora puede moverse, saltar y rodar mientras dispara; el reto es mantenerse fuera del alcance usando la arquitectura.

### Armas

- **Pistolas dobles** (munición infinita): 1 de daño por disparo, cadencia 0,24 s, alcance 16 m, 85 % de acierto con línea de visión.
- **Escopeta** (fase 2): 4 de daño a menos de 4 m, 1 más lejos, cadencia 0,9 s, 6 cartuchos por caja.
- **Bengalas** (fase 2): no son un arma; iluminan 30 s en un radio de 8 m. Imprescindibles en Las Cisternas.
- Sin daño localizado ni recarga en fase 1.

### Reglas de apuntado

- Con Disparar mantenido, Nora fija el enemigo vivo más cercano con línea de visión y lo sigue con el torso y los brazos (IK de brazos, no gira el cuerpo entero mientras corre).
- El objetivo no cambia solo mientras siga visible; se cambia a mano.
- Sin objetivo, dispara al frente sin efecto.

### Enemigos

Cada enemigo es un JSON con estadísticas y un comportamiento de una lista cerrada. Así se crean variantes sin código.

- **Chacál** (PoC): 4 de vida, 4,1 m/s, mordisco de 9 cada 0,9 s a menos de 1,1 m. Sube 1 click, no salta ni baja más de 1 m. Caza en pareja.
- **Murciélago:** 2 de vida, vuela en picado desde el techo, 4 de daño. Obliga a mirar arriba.
- **Escorpión gigante:** 8 de vida, lento (2 m/s), pinzas de 15 y aguijón que envenena (1 por segundo durante 8 s, se cura con botiquín).
- **Guardián de piedra** (mini jefe): inmune hasta que se le hace caer en una trampa o se le rompe el núcleo desde arriba. Un puzle con forma de enemigo.
- **Cocodrilo** (Cisternas): solo en agua, 6 de vida, 20 de daño. Saber cuándo no nadar.

### Comportamiento

- Estados: `idle`, `alert`, `chase`, `attack`, `hurt`, `flee`, `dead`.
- Percepción por distancia, altura y línea de visión (como en el PoC), y por ruido: correr, disparar y romper losas alertan en radios de 6, 14 y 10 m.
- Pathfinding: A\* sobre la rejilla con costes por altura; cada tipo declara qué saltos puede dar. Se recalcula como máximo cada 0,5 s.
- Un lugar alto es un refugio válido, como en el PoC: si el enemigo no puede llegar, merodea debajo y se aleja al cabo de 8 s.
- Al reaparecer en un punto de control, los enemigos vivos vuelven a su posición inicial y se olvidan de Nora.

### Salud

- Nora tiene 100 de vida. Botiquín pequeño cura 50, grande cura 100; se guardan en el inventario y se usan con una tecla (H) o desde el menú.
- Sin regeneración. Destello rojo en los bordes al recibir daño y latido con menos de 25.

## 8. Puzles, mecanismos y trampas

Todo lo que reacciona en el nivel pasa por un único sistema de eventos declarativo: entidades que emiten señales, reglas `when → do` en el JSON del nivel y flags con nombre. En el PoC la palanca, la placa y la puerta estaban cableadas en código; aquí se escriben como datos.

### Sistema de eventos

- **Señales:** cada entidad emite eventos con nombre (`palanca1.used`, `placa2.pressed`, `placa2.released`, `zona3.entered`, `enemigo4.dead`, `item.picked:llave_sol`).
- **Reglas:** `{ "when": "<señal o expresión>", "do": [acciones], "once": true }`. Las expresiones admiten `and`, `or`, `not` y flags: `"placa1.pressed and placa2.pressed"`.
- **Acciones:** `x.open`, `x.close`, `x.toggle`, `x.activate`, `flag set nombre`, `camera.focus x 2s`, `sfx nombre`, `music nombre`, `hint texto_id`, `spawn enemigo_id`, `checkpoint`, `wait 1.5s` (secuencias), `level.end`.
- **Temporizadores:** una puerta puede cerrarse sola a los N segundos (`open 12s`) con tictac audible: base de los puzles de carrera contra reloj.
- **Estado guardable:** flags y estado de cada entidad forman parte de la partida guardada.

### Mecanismos

- **Palanca** de pared y de suelo; de un uso o de dos posiciones.
- **Placa de presión:** por bloque (como el PoC), por Nora o por cualquiera. Opción de mantenerse pulsada solo mientras haya peso.
- **Puerta y reja:** se hunde, se levanta o se abre en dos hojas; altura en clicks.
- **Bloque empujable:** 1 bloque de alto (como el PoC) o de medio bloque; puede caer por huecos y quedar como nuevo suelo.
- **Plataforma móvil:** sigue un recorrido de sectores; Nora se mueve con ella.
- **Pilar giratorio / espejo:** rota 90° por uso; puzles de luz solar en El Templo del Sol.
- **Cerradura y hueco de objeto:** requiere un objeto del inventario (llave, gema, disco solar).
- **Compuerta de agua:** sube o baja el nivel del agua de una sala, cambiando qué bordes son alcanzables.
- **Cuerda para tirar:** como palanca, pero colgando (Acción en el aire).

### Trampas

Toda trampa tiene un aviso previo legible (pilar 4) y se reinicia al volver a un punto de control.

- **Foso de estacas** (PoC): muerte al caer.
- **Losas que ceden** (PoC): grieta visible, 0,55 s de margen, crujido al pisar.
- **Roca rodante:** se activa por zona, rueda por un pasillo; Nora debe correr y saltar a un hueco lateral. Mata al contacto.
- **Cuchillas pendulares:** ciclo fijo de 2,4 s, 40 de daño y empuje.
- **Dardos:** salen de la pared al pisar una losa marcada; veneno como el escorpión.
- **Techo que baja:** sala cerrada con temporizador; resolver o morir aplastada.
- **Suelo de fuego:** sectores con `death` que se encienden y apagan con ritmo.

### Principios de diseño de puzles

1. Mostrar la meta antes que el camino (la reliquia se ve desde el principio).
2. Un mecanismo nuevo por nivel, presentado solo y seguro, y luego combinado.
3. Todo lo que se mueve se ve moverse: `camera.focus` al activar algo fuera de plano.
4. Nunca un estado sin salida: si un bloque puede quedar atascado, el nivel incluye una forma de reiniciar el puzle (palanca de reinicio o reaparición del bloque). El validador del nivel lo comprueba (sección 16).

## 9. Objetos, inventario, secretos y guardado

Inventario pequeño y significativo, tres secretos por nivel y guardado libre en escritorio con puntos de control en todas las plataformas.

### Objetos

- **Consumibles:** botiquín pequeño y grande, bengalas, munición de escopeta.
- **Llaves de puzle:** llave, gema, disco solar, fragmento de mapa. Se definen por nivel en JSON (`id`, nombre, descripción, modelo, dónde encaja).
- **Reliquia del nivel:** su recogida dispara `level.end` (el Corazón de Ámbar en el PoC).
- Recogida: automática para consumibles al pasar por encima; con Acción y animación de agacharse para llaves y reliquias.

### Inventario

- Anillo circular 3D que gira alrededor de Nora al pulsar I, Tab o Select; pausa el juego. Homenaje a los clásicos con diseño propio.
- Tres anillos: objetos (consumibles y llaves), opciones (guardar, cargar, ajustes) y diario (notas encontradas).
- Usar un objeto de puzle frente a su hueco lo coloca; si no hay hueco, Nora niega con la cabeza.

### Secretos

- Tres por nivel, cada uno un ídolo distinto (oro, jade, piedra). Suena un acorde propio al encontrarlo (como en el PoC).
- Siempre en sitios que se ven pero cuesta alcanzar: saltos arriesgados, paredes escalables escondidas, bloques que revelan pasadizos.
- Recompensa: encontrar los tres de un nivel desbloquea algo visible (traje alternativo, modo linterna, galería de arte de Claude Design).

### Estadísticas de nivel

Al terminar: tiempo, distancia recorrida, disparos, acierto, botiquines usados, muertes, secretos y enemigos (el PoC ya muestra 4 de ellas).

### Guardado

- **Puntos de control** automáticos definidos en el nivel (acción `checkpoint`), con aviso discreto.
- **Guardado libre** en escritorio: 8 ranuras desde el anillo de opciones, en cualquier momento en que Nora esté en el suelo.
- En móvil: autoguardado al pasar a segundo plano (`visibilitychange`), porque el sistema puede cerrar la pestaña.
- Almacenamiento en IndexedDB. Cada partida guarda `World` serializado, versión de esquema y una miniatura de 160 × 90.
- Migraciones de esquema numeradas (`save/migrations/001.ts`) para no romper partidas al actualizar.
- Exportar e importar partida como archivo para pasarla entre dispositivos (sin cuentas ni servidor en fase 1).

## 10. Editor de niveles

El editor vive dentro del juego en modo desarrollo (`/editor`) y guarda el mismo `*.level.json` que carga el juego. Su objetivo es que diseñar una sala nueva y probarla lleve minutos, y que Claude Code pueda generar o modificar niveles escribiendo JSON que el editor abre sin conversión.

### Funciones de fase 1

- Vista cenital de la sala activa con rejilla; clic para subir o bajar el suelo un click, Shift + clic para el techo, rueda para cambiar la herramienta.
- Herramientas: altura, pared, foso, pendiente (arrastrar entre esquinas), agua, material, flags de sector (escalable por lado, losa que cede, muerte).
- Colocar entidades desde una paleta (palanca, puerta, bloque, placa, enemigo, objeto, secreto, brasero, trigger de zona) y editar sus propiedades en un panel lateral.
- Vista 3D en vivo al lado con la misma cámara del juego; tecla P para jugar desde el punto del cursor y Esc para volver al editor sin recargar.
- Editor de reglas `when → do` con autocompletado de ids de entidades.
- Deshacer y rehacer ilimitados; guardado en el sistema de archivos con la File System Access API (Chrome) o descarga del JSON.

### Ayudas al diseño

- **Superposición de alcance:** colorea qué sectores son alcanzables desde el punto elegido andando, saltando o agarrándose, usando las mismas constantes del controlador. Es la herramienta que más ahorra pruebas.
- **Medidas:** al pasar el ratón entre dos sectores muestra distancia en bloques y diferencia en clicks, y si el salto es posible.
- **Validación en vivo:** avisos de entidades sin conectar, reglas que apuntan a ids inexistentes, secretos inalcanzables, bloques que pueden quedar atascados (sección 16).

### Fase 2

- Varias salas en la misma vista con portales visibles.
- Pintado de iluminación (luces puntuales y color ambiente por sala) y horneado de luz en vértices o lightmaps.
- Plantillas de sala (pasillo, sala de columnas, pozo) para empezar más rápido.

## 11. Dirección de arte: realismo con Claude Design

El juego apunta a un realismo cinematográfico de aventura: piedra que parece piedra, fuego que baila sobre relieves tallados, polvo suspendido en rayos de sol. Claude Design es el director de arte del proyecto: define cada decisión visual antes de que Claude Code la implemente y revisa capturas del juego en cada hito. El realismo en sí lo producen materiales PBR escaneados, iluminación y postproceso; Claude Design no genera mallas 3D, así que los modelos siguen un pipeline aparte guiado por sus hojas.

### Principios visuales

1. **Realismo con intención.** Referencias de fotografía arqueológica y cine de aventura, no fotorrealismo neutro: cada sala tiene su momento de luz.
2. **La luz cuenta la historia.** Fuego cálido contra luz cenital fría; oscuridad que invita a encender una bengala; la reliquia siempre es el punto más brillante de su cámara.
3. **Escala y asombro.** Salas altas con profundidad atmosférica, niebla que separa planos y siluetas recortadas al fondo.
4. **Materiales creíbles.** Arenisca, caliza, granito, bronce oxidado, oro, madera seca, agua quieta y agua en movimiento, cada uno con su respuesta a la luz.
5. **Legibilidad intacta.** La belleza nunca oculta el juego: bordes agarrables con desgaste y marcas de manos, paredes escalables con grietas y raíces, losas que ceden con fisuras visibles, trampas con su aviso. Cada concept de Claude Design incluye una versión "lectura de juego" que lo comprueba.

### La rejilla es invisible

La colisión sigue siendo de bloques, pero lo que se ve no parece hecho de cubos. El constructor de salas viste cada sector con un kit modular realista:

- Piezas con biseles, erosión y juntas: suelos, paredes, esquinas, bordes de saliente, escalones, rampas, columnas, arcos, marcos de puerta, dinteles y estatuas.
- La superficie visual puede desviarse hasta 5 cm de la colisión para romper la rectitud sin engañar al jugador.
- Vestido automático por reglas y semilla: variante de pieza por sector, escombros en la base de las paredes, decals de musgo, hollín sobre braseros, arañazos junto a bordes agarrables. El diseñador puede sobrescribir cualquier sector desde el editor.

### Lo que entrega Claude Design, en este orden

1. **Biblia de arte:** referencias, reglas de forma, materiales y legibilidad, y lista de lo que se evita (cualquier parecido con Tomb Raider).
2. **Guion de color y luz:** una lámina por sala clave con temperatura de la luz, fuentes, niebla, contraste y hora del día. Cada lámina se traduce a un archivo `art/looks/<sala>.json` (color ambiente, niebla, luces, LUT, exposición) que el juego carga tal cual.
3. **Biblioteca de materiales:** una ficha por material (color base, rugosidad, suciedad, desgaste, ejemplo fotográfico) que guía la elección de texturas escaneadas.
4. **Hojas de Nora:** proporciones reales, vestuario con materiales (lona, algodón, cuero gastado), pelo, desgaste por nivel, traje alternativo y expresiones para cinemáticas.
5. **Hojas de enemigos** con anatomía real y variantes.
6. **Concept de la vista clave de cada cámara:** la composición que el nivel debe reproducir desde una cámara de referencia.
7. **Interfaz:** HUD mínimo casi diegético, inventario con objetos renderizados, menús sobre escenas vivas del juego, tipografía, iconografía y design system del juego exportado a `src/ui/tokens.css`.
8. **Identidad:** logotipo, key art, pantalla de carga e iconos de la PWA.
9. **Revisión visual por hito:** Claude Code genera capturas desde las cámaras de referencia de cada sala; Claude Design las compara con su concept y devuelve una lista de ajustes de luz, color y composición. Un hito visual no se cierra sin su aprobación.

### Render (Three.js)

- **Renderer:** `WebGPURenderer` con caída automática a WebGL2; materiales PBR (`MeshStandardMaterial` y `MeshPhysicalMaterial` para agua, oro y piel).
- **Iluminación:** lightmaps horneados en Blender con iluminación global para lo estático; luces de fuego dinámicas con sombra en las 2 o 3 más cercanas; sondas de irradiancia para iluminar a Nora y los enemigos de forma coherente con la sala; sondas de reflexión por sala.
- **Sombras:** sombras en cascada para la luz del sol, sombras de fuego cercanas y sombras de contacto.
- **Atmósfera:** niebla volumétrica con rayos de luz, partículas de polvo, humo y chispas de braseros.
- **Agua:** refracción, reflejos, espuma en bordes y cáusticas proyectadas en paredes y suelo de las cisternas.
- **Fuego:** llamas en flipbook con luz parpadeante acoplada a la animación.
- **Postproceso:** tonemapping AgX, oclusión ambiental (GTAO), bloom, LUT por sala, viñeta y grano de película sutiles, antialiasing temporal, profundidad de campo en cámaras de nivel.
- **Detalle cercano:** parallax occlusion en suelos, decals, vegetación en patios abiertos.

### Niveles de calidad

- **Alto** (escritorio con GPU dedicada, WebGPU): todo lo anterior.
- **Medio** (portátil con gráfica integrada): lightmaps, una luz con sombra, bloom, SMAA, rayos de luz simulados con conos en vez de volumétrica.
- **Móvil:** lightmaps, sombra de contacto solo para Nora, texturas 1K, sin oclusión ambiental.
- Detección automática con una prueba de 3 s en el primer arranque y ajuste manual en opciones.
- **Modo retro** como extra desbloqueable: el filtro del PoC (píxeles gordos, texturas nítidas) en homenaje a los clásicos.

### Assets

- **Texturas y cielos:** Poly Haven y ambientCG (escaneos CC0), en 2K para calidad alta, 1K media y 512 px móvil; trim sheets para bordes y molduras.
- **Kit modular:** Blender, a partir de esos escaneos; de 500 a 3.000 triángulos por pieza con LOD.
- **Nora:** de 25.000 a 40.000 triángulos en alto, con LOD; pelo con tarjetas; texturas PBR 4K con piel de dispersión aproximada. Modelado por artista 3D a partir de las hojas de Claude Design, o Character Creator con licencia de exportación para juegos. MetaHuman no sirve: su licencia se limita a Unreal.
- **Enemigos:** de 8.000 a 15.000 triángulos.
- **Animación:** esqueleto humanoide estándar; base de Mixamo más captura de movimiento propia (Move.ai o Rokoko) para los movimientos del género, retocada a mano.
- **Formato:** glb con Meshopt, texturas KTX2 (UASTC para normales, ETC1S para el resto), carga por salas.

### Lista de animaciones de Nora

`idle`, `walk`, `run`, `run_stop`, `jump_start`, `jump_up`, `jump_forward`, `jump_back`, `jump_side_L/R`, `fall`, `land_soft`, `land_hard`, `hang`, `shimmy_L/R`, `climb_up`, `drop_to_hang`, `push`, `pull`, `lever_wall`, `lever_floor`, `pickup`, `use_slot`, `roll`, `slide`, `wallclimb_up/down/L/R`, `swim_surface`, `swim_dive`, `tread`, `hurt`, `death_fall`, `death_spikes`, `death_drown`, y capa aditiva `aim_arms` para disparar mientras corre.

Hasta tener modelos finales, se mantiene el personaje de cajas del PoC con animación procedural: permite ajustar el juego sin esperar al arte. La sala de muestra (sección 17) se hace pronto para descubrir el coste real del realismo antes de producir niveles.

## 12. Audio

El silencio es parte del diseño: ambiente continuo y discreto, música solo en momentos marcados y efectos que informan (cada trampa y mecanismo suena antes de actuar). Todo el audio pasa por un mezclador propio sobre Web Audio.

### Mezclador

- Buses: `music`, `ambience`, `sfx`, `ui`, `voice`, con volumen independiente en opciones.
- Reverb por sala mediante convolución con 4 presets (`stone_small`, `stone_medium`, `hall_large`, `water_cistern`) declarados en el nivel.
- Sonido 3D con `PannerNode` HRTF para fuentes puntuales (braseros, enemigos, mecanismos lejanos).
- Oclusión simple: si no hay línea de visión con la fuente, filtro paso bajo a 800 Hz.
- Ducking: la música baja 6 dB cuando suena un aviso de trampa o un diálogo.

### Contenido

- **Ambiente por sala:** viento en galerías, goteo en cisternas, zumbido grave en cámaras selladas (el PoC ya usa un drone de 55 Hz y ruido filtrado).
- **Pisadas por material:** arena, piedra, metal, madera, agua poco profunda; 4 variaciones cada una.
- **Nora:** respiración al trepar, esfuerzo al empujar, grito corto al caer, jadeo al salir del agua. Sin frases habladas en fase 1.
- **Mecanismos:** palanca, losa arrastrada, puerta de piedra, reja metálica, crujido de losa que cede.
- **Música:** tema principal, un motivo breve al entrar en una sala importante, música de persecución para la roca rodante y el jefe, fanfarria al terminar el nivel.
- **Secreto:** acorde propio y reconocible (el PoC ya tiene un arpegio de 4 notas), que nunca se parezca al de los clásicos.

### Producción

- Efectos generados por código en el PoC; en fase 2 se sustituyen por grabaciones o bancos con licencia CC0 (Freesound, Sonniss GDC bundle) procesados.
- Música: compositor externo o librería con licencia; formato Opus en WebM con AAC de respaldo para Safari antiguo.
- Todos los sonidos se disparan por eventos de la simulación (`sfx.map.json` relaciona evento y sonido), nunca desde el código de juego.

## 13. Interfaz, controles y accesibilidad

HUD mínimo que desaparece cuando no hace falta, tres esquemas de control con remapeo completo y accesibilidad desde la fase 1. El diseño visual de todo esto sale de Claude Design (sección 11).

### HUD

- Barra de salud arriba a la izquierda, visible solo al recibir daño, al curarse o con menos de 50.
- Barra de aire bajo el agua; barra de munición solo con escopeta.
- Indicador de acción contextual abajo al centro ("E · accionar la palanca"), como en el PoC, con el icono del botón del dispositivo activo.
- Avisos de texto grandes y breves: secreto, punto de control, mecanismo activado.
- Pistas de tutorial la primera vez que aparece cada mecánica, desactivables.

### Controles por defecto

**Teclado y ratón**

- Mover: WASD o flechas. Cámara: ratón (arrastrar o bloqueo de puntero). Zoom: rueda.
- Saltar: Espacio. Acción: E. Andar: Shift. Disparar: F o clic derecho. Rodar: Q.
- Sacar o guardar armas: R. Botiquín: H. Bengala: G. Inventario: I o Tab. Pausa: Esc. Recentrar cámara: C.

**Mando (Gamepad API, esquema estándar)**

- Stick izquierdo mover, stick derecho cámara, A saltar, X acción, B rodar, RT disparar, LT andar, RB armas, LB bengala, Y botiquín, Select inventario, Start pausa.
- Vibración en caídas, golpes y mecanismos pesados donde el navegador la soporte.

**Táctil**

- Joystick flotante en la mitad izquierda (aparece donde se toca), arrastre en la mitad derecha para la cámara.
- Botones: Saltar, Acción (mantener), Disparar, Andar (interruptor), Rodar, e inventario en la esquina superior.
- Tamaño mínimo de botón 56 px, posiciones y opacidad configurables.
- En táctil, el auto-agarre (sección 5) queda siempre activo.

### Menús

- Principal: continuar, nueva partida, cargar, selección de cámara (nivel) desbloqueada, opciones, créditos.
- Opciones: controles y remapeo, sensibilidad e inversión de ejes, esquema relativo o tanque, ayudas, audio por bus, gráficos (retro o nítido, sombras, bloom, límite de fps), idioma, accesibilidad.
- Todo navegable con teclado y mando, con foco visible.

### Accesibilidad

- Subtítulos para todo sonido relevante ("\[Crujido de piedra a la izquierda\]"), con tamaño configurable.
- Aviso visual de trampas acompañando al sonoro.
- Modo de alto contraste para bordes agarrables y paredes escalables.
- Reducción de movimiento: sin temblor de cámara ni balanceo (el PoC ya respeta `prefers-reduced-motion` en el temblor).
- Mantener o alternar para Acción y Andar.
- Velocidad de juego al 75 % como opción, sin penalizar estadísticas.
- Paletas seguras para daltonismo en indicadores de salud y veneno.

### Localización

- Textos en `i18n/*.json` desde el primer día; castellano, inglés y catalán en fase 3.

## 14. Rendimiento, plataformas y PWA

El objetivo es 60 fps estables en hardware modesto y arranque rápido en móvil. Con realismo en el navegador, el límite real está en luces, sombras, postproceso y memoria de texturas; por eso todo tiene niveles de calidad (sección 11).

### Presupuestos por frame (60 fps)

- Simulación: menos de 2 ms por tick en todas las calidades.
- Alto: menos de 400 draw calls, hasta 1,5 millones de triángulos visibles, 3 luces con sombra, 1 GB de memoria de GPU por nivel.
- Medio: menos de 250 draw calls, 600.000 triángulos, 1 luz con sombra, 600 MB.
- Móvil: menos de 150 draw calls, 300.000 triángulos, sin sombras dinámicas salvo contacto de Nora, 400 MB.

### Técnicas

- Geometría estática fusionada por sala y material; `InstancedMesh` para piezas del kit, pinchos, columnas y escombros (el PoC ya instancia los pinchos).
- LOD en kit, personajes y props, con transición suave por distancia.
- Visibilidad por portales: solo se renderizan la sala actual y las visibles a través de portales, con profundidad máxima de 3; las luces y sombras de salas no visibles se apagan.
- Lightmaps horneados por sala en el build; dinámicas solo las luces de fuego cercanas, bengalas, fogonazos y reliquias.
- Postproceso con un único pase combinado siempre que se pueda.
- Escalado dinámico de resolución si el frame supera 18 ms durante 1 s; baja un nivel de calidad si no basta.
- Carga por salas en segundo plano: al acercarse a un portal se descarga la sala siguiente.
- Texturas KTX2 y modelos Meshopt; memoria vigilada con `renderer.info` en el panel de depuración.

### Plataformas

- **Escritorio:** Chrome, Edge, Firefox y Safari de los últimos 2 años.
- **Móvil:** Safari iOS 17 o superior, Chrome Android. Pantalla completa y bloqueo de orientación horizontal cuando el navegador lo permita; aviso para girar el móvil si no.
- **Mando:** Xbox, PlayStation y Switch Pro por Gamepad API.
- Aviso claro si no hay WebGL2.

### PWA

- Manifest con iconos de Claude Design, `display: fullscreen`, orientación horizontal.
- Service worker (Workbox) con precaché del motor y caché por nivel bajo demanda; el juego completo funciona sin conexión una vez descargado.
- Aviso de actualización disponible sin interrumpir una partida en curso.

### Publicación

- Vercel o Netlify desde `main`, con previsualización por pull request.
- Versión visible en el menú (`v0.3.1 · abc1234`) para reportar errores.

## 15. IA en el juego y en el desarrollo (propuesta)

La IA se usa donde ayuda al jugador a no quedarse atascado y donde acelera el desarrollo. Nunca decide nada que el jugador deba aprender: movimiento, física, enemigos y puzles son deterministas (pilares 1 y 4).

### En el juego: el diario de Nora

- Tras 3 minutos sin progreso en una sala (sin nuevo flag, objeto ni sector alcanzado), aparece un icono discreto: "Nora tiene una idea". El jugador decide si la escucha.
- Pistas graduadas en 3 niveles: observación ("esa placa parece esperar algo pesado"), dirección ("el bloque de la sala anterior podría moverse") y solución. Cada nivel se pide expresamente.
- **Contexto que recibe el modelo:** la sala en JSON, los flags, qué entidades ha tocado el jugador, dónde ha estado y cuánto tiempo. Nunca la partida entera.
- **Voz:** siempre en primera persona de Nora, breve (máx. 25 palabras), sin nombrar botones ni mecánicas de juego.
- **Técnica:** Claude API detrás de un proxy mínimo (Vercel Function o Netlify Function, según el hosting elegido) con límite por sesión; respuesta en menos de 2 s.
- **Sin conexión:** el build pregenera con Claude 3 pistas por puzle a partir del JSON del nivel, se revisan a mano y se guardan en `levels/<id>.hints.json`. El juego usa estas si no hay red o si el jugador desactiva la IA.
- Opción de menú: pistas desactivadas, solo pregeneradas o adaptativas.

### En desarrollo: bot de playtest

- La simulación recibe `InputFrame` y corre sin render en Node, así que un agente puede jugar miles de veces más rápido que en tiempo real.
- Fase 1: un buscador (BFS sobre estados de rejilla y movimientos del controlador) demuestra que cada nivel se puede completar y que cada secreto es alcanzable, y devuelve la ruta como repetición reproducible.
- Fase 2: un agente con Claude que juega a partir de observaciones (sala, posición, entidades) y reporta dónde se atasca, qué salto le cuesta y qué pista no le ayudó. Da una señal temprana de dónde se frustrarán las personas.
- Cada informe se guarda en `reports/` con la repetición para abrirla en el juego.

### En desarrollo: asistente de niveles

- Claude Code genera borradores de sala en JSON desde una descripción ("cisterna con dos alturas y una compuerta que baja el agua"), usando la leyenda y las reglas de alcance de este spec.
- El validador y el bot confirman que se puede recorrer antes de que el diseñador lo abra en el editor. El diseño final siempre lo retoca una persona.

### Opcional

- Texto a voz para leer las notas del diario encontradas en las tumbas, pregenerado en el build (no en tiempo real).

### Descartado

- Enemigos con comportamiento generado por un modelo: rompe la previsibilidad.
- Niveles generados en tiempo de juego: contradice "el nivel es el puzle".
- Modelos locales en el navegador para las pistas: cientos de MB de descarga, inviable en móvil.

## 16. Calidad y testing

La simulación determinista permite tests que en otros juegos son imposibles: cada salto, agarre y puzle se prueba en CI sin abrir un navegador. La regla es que ningún cambio en `sim/` se fusiona sin tests en verde.

### Tests de movimiento (Vitest)

- Salas mínimas en JSON por caso: "salto con carrerilla cruza 2 bloques", "salto parado no cruza 2", "agarre a 3 clicks desde parado", "no agarre a 8 clicks", "andar no cae por un borde", "subida automática de 1 click", "empujar bloque contra pared no hace nada".
- Cada test ejecuta una secuencia de `InputFrame` y comprueba estado final, posición con tolerancia de 1 cm y eventos emitidos.
- Los valores de la sección 5 viven en `tuning.ts`: si alguien los cambia, estos tests dicen qué promesa de diseño se ha roto.

### Repeticiones doradas

- Se graba una partida completa de cada nivel (lista de `InputFrame` + semilla). En CI se reproduce y se compara el hash del `World` cada 60 ticks.
- Si difiere, el test muestra el primer tick divergente. Si el cambio es intencionado, se regraba con un comando (`pnpm replay:update`).

### Validador de niveles

Se ejecuta en el build y en el editor. Falla el build si:

- El esquema JSON no valida o una regla apunta a un id inexistente.
- La salida del nivel no es alcanzable desde el inicio (búsqueda sobre el grafo de alcance del controlador).
- Un secreto no es alcanzable.
- Existe un estado sin salida: un bloque empujable puede quedar donde bloquea el único camino y no hay forma de reiniciar el puzle.
- Un punto de control queda en un sector con `death` o dentro de un volumen de trampa.

### Humo en navegador (Playwright)

- Cargar cada nivel, jugar 10 s con una repetición corta y comprobar que no hay errores de consola y que el frame medio está por debajo de 20 ms en Chromium con WebGL por software.
- Capturas de pantalla de referencia de menús y HUD para detectar regresiones visuales.

### Pruebas con personas

- Al cerrar cada fase, 5 personas juegan sin ayuda mientras se graba pantalla y la telemetría local (muertes por sala, tiempo por sala, pistas pedidas).
- Se corrige primero lo que frustra a 2 de 5 o más.

### Herramientas de depuración (modo dev)

- F1 panel de ajuste de constantes en caliente; F2 ver colisiones y sectores; F3 grafo de alcance; F4 cámara libre; F5 guardar repetición de los últimos 60 s.

## 17. Plan de trabajo con Claude Code

La fase 1 se divide en 8 hitos pequeños, cada uno cerrado con una demo jugable y tests. Claude Code trabaja hito a hito con este spec en `docs/spec.md` y las reglas de `CLAUDE.md`; Claude Design trabaja en paralelo en la dirección de arte desde el hito 3.

### Hitos de la fase 1

1. **Esqueleto.** Repo `ninth-chamber` con Vite, TS, Three.js, Vitest, ESLint, CI y despliegue de previsualización. Bucle de paso fijo, `InputFrame`, teclado, mando y táctil. *Demo:* un cubo que se mueve a 60 Hz.
2. **Rejilla y nivel v1.** Esquema del nivel con Zod, cargador, construcción de mallas por sala, consultas `floorAt`, `sweepCircle`, `ledgeAt`. Portar el mapa del PoC a JSON. *Demo:* las 4 salas del PoC visibles.
3. **Controlador base.** Estados Suelo, Aire, Colgada, Trepar, Agarre y Empujar con las constantes del PoC; personaje de cajas con animación procedural. Tests de movimiento. *Demo:* el PoC completo jugable sin enemigos, con las mismas sensaciones.
4. **Sistema de eventos y mecanismos.** Reglas `when → do`, flags, palanca, placa, puerta, losa que cede, foso, puntos de control. *Demo:* el PoC completo con lógica en JSON.
5. **Cámara y enemigos.** Cámara con colisión y cámaras de nivel; chacal con A\*; pistolas con apuntado. *Demo:* el PoC completo al 100 %, ya modular.
6. **Movimientos ampliados.** Saltos atrás y laterales, rodar, bajar a colgar, pendientes, escalar paredes, agua. Tests de cada uno.
7. **Editor.** Edición de sectores y entidades, reglas, superposición de alcance, jugar desde el cursor. Validador de niveles en el build.
8. **La Antesala.** Primer nivel real (10 a 14 salas) diseñado con el editor, audio base, HUD y menús con los diseños de Claude Design, guardado. Pruebas con 5 personas: puerta de la fase 1.

### Hitos visuales, en paralelo

Claude Design y Claude Code avanzan el aspecto visual a la vez que el código, para descubrir pronto cuánto cuesta el realismo en el navegador.

1. **V1 · Dirección de arte** (durante los hitos 1 y 2). Biblia de arte, guion de color y luz de La Antesala, biblioteca de materiales y hojas de Nora en Claude Design. Claude Code prepara `art/looks/*.json` y el comando `pnpm shots` de capturas de referencia.
2. **V2 · Sala de muestra** (durante los hitos 3 a 5). Una sala de La Antesala a calidad final: kit modular, lightmaps, fuego, polvo, agua, postproceso y niveles de calidad, con Nora provisional. *Puerta:* Claude Design aprueba las capturas frente a su concept; 60 fps en alto, 60 en medio y 30 o más en móvil.
3. **V3 · La Antesala completa** (hito 8). Nora final animada, enemigos, interfaz de Claude Design aplicada y revisión visual de todas las cámaras de referencia.

### CLAUDE.md inicial

```markdown
# The Ninth Chamber

Juego de exploración de tumbas en navegador. Spec completo en docs/spec.md: léelo antes de cualquier cambio de diseño.

## Reglas
- TypeScript strict. Sin any salvo en límites con librerías.
- src/sim no importa three ni nada del DOM. Todo lo de sim/ debe correr en Node.
- Prohibido Math.random y Date.now en sim/: usa world.rng y el contador de ticks.
- Nada de motores de física genéricos. Colisión de rejilla propia.
- Constantes de juego solo en src/sim/player/tuning.ts.
- La simulación emite eventos; audio, render y UI solo escuchan.
- Niveles en levels/*.level.json, validados con el esquema de src/sim/grid/schema.ts.
- No usar nombres, personajes ni recursos de Tomb Raider.
- Lo visual sigue art/looks/*.json y los concepts de Claude Design en docs/art/. Tras cualquier cambio visual, regenera las capturas de referencia con pnpm shots y compáralas con el concept.

## Flujo
- Antes de tocar sim/: escribe o actualiza el test de movimiento en tests/.
- pnpm test y pnpm validate:levels deben pasar antes de dar un hito por terminado.
- Cada hito termina con una demo en la URL de previsualización y una nota en docs/changelog.md.

## Comandos
- pnpm dev, pnpm test, pnpm validate:levels, pnpm replay:update, pnpm shots, pnpm build
```

### Primer prompt para Claude Code

```text
Lee docs/spec.md y docs/poc/tumba.html (el PoC). Implementa el hito 1 de la sección 17: esqueleto del repo ninth-chamber con Vite + TypeScript + Three.js, bucle de paso fijo a 60 Hz con interpolación, InputFrame desde teclado, mando y táctil, Vitest, ESLint y CI de GitHub Actions con despliegue de previsualización. Añade el CLAUDE.md del spec. Termina con una demo de un cubo controlable y un test del bucle fijo. No empieces el hito 2.
```

### Reparto entre Claude Code y Claude Design

- **Claude Design:** dirección de arte completa de la sección 11 (biblia, guion de color y luz, materiales, Nora, enemigos, concepts de cada cámara, interfaz e identidad) y la revisión visual de cada hito.
- **Claude Code:** todo el código, los niveles en JSON, la integración de los tokens de UI exportados de Claude Design y el pipeline de assets.
- **Tú:** diseño de niveles en el editor, decisiones de la sección 18 y las pruebas con personas.

## 18. Riesgos y decisiones abiertas

El mayor riesgo no es técnico: es que el movimiento pierda la sensación del PoC al modularlo, y que el arte 3D se convierta en el cuello de botella. Ambos se mitigan con tests de movimiento y con el personaje de cajas como sustituto hasta que el arte esté listo.

### Riesgos

- **Sensación del controlador.** Al portar el PoC se pierde el "feel". *Mitigación:* el hito 3 exige paridad con el PoC antes de añadir nada; repeticiones grabadas en ambos para comparar.
- **Coste del realismo.** Nora realista, animaciones capturadas y kit modular son el mayor gasto de tiempo y dinero, y lo único que Claude Design no produce. *Mitigación:* sala de muestra temprana (V2) para medir el coste real; escaneos CC0; encargo externo solo para Nora; personaje de cajas mientras tanto.
- **Rendimiento web con realismo.** Sombras, volumétricos y postproceso pueden hundir el frame, sobre todo en móvil. *Mitigación:* niveles de calidad, lightmaps, escalado dinámico, presupuestos de la sección 14 medidos en CI.
- **Tamaño de descarga.** Texturas de alta calidad engordan el juego. *Mitigación:* KTX2, carga por salas, texturas según calidad.
- **Belleza contra legibilidad.** Un escenario muy detallado esconde los bordes agarrables. *Mitigación:* versión "lectura de juego" en cada concept y modo de alto contraste.
- **Cámara en espacios estrechos.** Siempre da guerra en este género. *Mitigación:* cámaras fijas por volumen en pasillos y transparencia de Nora.
- **Controles táctiles.** La precisión de saltos en pantalla táctil es difícil. *Mitigación:* ayudas siempre activas en táctil y soporte de mando en móvil.
- **Parecido con Tomb Raider.** Riesgo legal si la protagonista, el logo o los sonidos se parecen demasiado. *Mitigación:* revisión explícita en cada entrega de Claude Design; nada de trenza, camiseta turquesa ajustada ni pistoleras en los muslos como rasgos de identidad.
- **Coste de la IA de pistas.** Llamadas a Claude API si el juego se hace popular. *Mitigación:* pistas pregeneradas por defecto, límite por sesión, adaptativas como opción.
- **Nombre.** "The Ninth Chamber" puede estar registrado. *Mitigación:* búsqueda en Steam, itch.io, EUIPO y USPTO antes de la fase 3.

### Decisiones abiertas

- [ ] Hosting: Vercel (Pro si hay uso comercial) o Netlify.
- [ ] ¿Se incluye la IA de pistas adaptativas o solo las pregeneradas?
- [ ] Esquema de control por defecto en móvil: joystick fijo o flotante.
- [ ] ¿Disparar con clic derecho o solo con F en escritorio?
- [ ] Modelado y animación de Nora: encargo a artista 3D, Character Creator o mezcla; presupuesto disponible.
- [ ] ¿Modo clásico (sin ayudas, controles tanque) visible desde el principio o desbloqueable?
- [ ] Licencia del código: abierto (MIT) con assets cerrados, o todo cerrado.
- [ ] Idiomas en fase 3: ¿solo ES y EN, o también CA?
- [ ] Nombre definitivo tras la búsqueda de marca.

## 19. Las cámaras IV a IX (especificación, sin construir)

Sep 27, 2026 · Especificación de las seis cámaras que faltan. Nada de esta sección está implementado: sirve para decidir el arco, el orden de producción y el trabajo técnico antes de construir ninguna. Las cámaras I a III (La Antesala, Las Cisternas, El Templo del Sol) están jugables desde la versión 0.2.0.

### El arco de la campaña

Las tres primeras reliquias ya dan las tres llaves de la novena que Elena enumera en su carta de 1989: **la estrella** (dónde mirar, el Corazón de Ámbar), **la noche sin luna** (cuándo, el Cristal de las Mareas) y **el rayo que no se talla** (hacia dónde caminar, el Disco Solar). Al terminar la tercera, Nora marca el noveno punto en el mapa, y entre ella y ese punto quedan "cinco puertas que no se abren desde hace tres mil años".

Las cámaras IV a VIII son esas cinco puertas. Ya no responden a *dónde* ni *cuándo*, sino a *cómo* se entra en la novena: cada reliquia es una parte de la llave. La novena es el nivel final.

| Cámara | Guardián | La reliquia da… | Mecanismo nuevo | Amenaza principal | Duración |
| --- | --- | --- | --- | --- | --- |
| IV · El Archivo de Barro | Tamrit, el escriba | **El nombre**: la palabra que abre la novena | Cerraduras de glifos que se leen en las notas | Guardián de barro que se rehace; dardos | 25 a 30 min |
| V · Las Salas de las Raíces | Erreth, la que brota | **El paso**: la raíz viva que sostiene la puerta | Paredes de raíces escalables; raíces que huyen del fuego | Escorpiones (veneno); suelos de raíz que ceden | 25 a 30 min |
| VI · La Fragua de Bronce | Bazûr, el fundidor | **La llave**: el noveno segmento del sello, fundido por Nora | Canales de bronce fundido que se desvían y se enfrían en puentes | Autómatas de bronce; calor; suelo de fuego | 30 a 35 min |
| VII · La Escalera del Viento | Suhal, el que canta | **La voz**: el tono que la puerta escucha | Viento: rachas con ritmo que empujan y alargan saltos | Caídas; rachas que tiran de las cornisas; aves | 25 a 30 min |
| VIII · El Observatorio | Anzur, el que mira | **El momento**: el astrolabio que une estrella, noche y dirección | Anillos de la cúpula que se giran para alinear el cielo | El octavo guardián, el jefe más largo | 35 a 40 min |
| IX · La Novena Cámara | (sin nombre) | Final de la campaña | Todo lo aprendido, sin nada nuevo | La propia cámara | 30 a 40 min |

Los nombres de los guardianes siguen el patrón de Qarrum, Nahrem y Ubara: inventados, cortos y sin referencias a lugares o dioses reales.

**Hilo de Elena y Ferrand.** Ferrand muere entre la segunda y la tercera cámara: el cuaderno que Nora encontró en las Cisternas termina con el dibujo del guardián del Templo, y Elena escribe en 1989 que Nora "ha llegado más lejos que Auguste". Elena llegó hasta la tercera en 1989, sin el Corazón, así que ninguna de las puertas IV a VIII se ha abierto en tres mil años. En estas cámaras ya no hay notas de 1956 ni de 1989. La voz del diario pasa a ser la de los constructores y la de Nora. Elena vuelve solo en la novena, que resuelve lo que "nunca contó" (ver IX).

**Reloj de la campaña.** El astrolabio de la octava calcula la próxima vez que coinciden la estrella, la luna nueva y el solsticio: dentro de pocos días. La novena se juega con ese plazo como motivo narrativo, no como temporizador real.

### Reglas comunes a las seis cámaras

- **Tamaño:** de 10 a 12 salas, tres secretos (ídolo de oro, jade y piedra), tres notas de diario, puntos de control antes de cada trampa y de cada combate, botiquines contados.
- **Un mecanismo nuevo por cámara** (§8, principio 2): se presenta solo y seguro en la primera sala donde aparece, se combina después con lo ya conocido y culmina en la sala de la reliquia.
- **Meta a la vista** (§8, principio 1): la reliquia o su puerta se ve desde una de las primeras salas.
- **Datos, no código:** cada cámara es `levels/<id>.level.json` con sus reglas `when → do`, sus looks en `art/looks/`, su lightmap horneado, su registro en `src/levels.ts` y su entrada en `src/ui/campaign.ts`, con intro, reliquia, teaser y notas del diario. Los textos van en `i18n/*.json`.
- **Verificación:**
  - `pnpm validate:levels`.
  - El bot recorre la cámara de principio a fin con los tres secretos, sin muertes.
  - Tests de "cada puzle es necesario" y tests de movimiento de cada mecánica nueva.
  - Capturas de referencia por sala en calidad alta y móvil.
  - Rendimiento medido con `pnpm bench`, dentro de los presupuestos de §14.
- **Música:** una paleta propia por cámara en el director adaptativo (exploración, tensión, combate, persecución, jefe, reliquia), con temas con licencia CC-BY o CC0 anotados en CREDITS.md.
- **Luz:** cada cámara tiene una fuente dominante que la distingue de las demás (arena y sol en la I, agua y bengalas en la II, bronce y sol en la III). Las nuevas se definen abajo.

---

### IV · El Archivo de Barro

**Premisa.** Bajo el Templo del Sol, un laberinto de estanterías talladas en la roca guarda diez mil tablillas de barro. Tamrit, el cuarto guardián, "lo escribió todo": la historia de los ocho, los nombres de los constructores y el nombre de la novena. El archivo es seco, silencioso y oscuro, y el polvo apaga el sonido de los pasos.

**Reliquia: la Tablilla del Nombre.** Una tablilla de barro cocido con nueve columnas de signos. Ocho columnas dicen el nombre de cada guardián. La novena solo tiene un signo, y ese signo es la palabra que abre la puerta. *Pista:* "Cómo llamar a la puerta".

**Mecanismo nuevo: cerraduras de glifos.** Cilindros de piedra con seis caras que se giran con Acción, como los tambores de espejos del Templo. Cada cerradura pide una secuencia que se deduce leyendo las notas y los relieves de la sala: la lectura es parte del puzle. Los glifos tienen forma y color distintos para ser legibles en móvil y con daltonismo, y la nota correspondiente se relee desde el diario.

**Recuperado.** La antorcha: varias galerías están a oscuras y el polvo en suspensión hace de haz visible. También los bloques: las estanterías bajas se empujan y se arrastran como bloques y abren pasillos.

**Amenazas.**
- **Dardos** (§8): losas marcadas con un trazo de pintura que disparan desde los nichos de las estanterías, con veneno leve.
- **Suelos de barro que ceden:** son las losas que ceden de la Antesala, con otra textura.
- **Tamrit, el escriba de barro:** una figura de barro húmedo que se rehace si se la rompe a disparos. Solo se la vence desbordando sobre ella el agua de las cisternas, que corre bajo el archivo, desde una compuerta superior. Enlaza con el mecanismo de agua de la II.

**Salas (propuesta).**
1. **Pozo de bajada** desde el Templo: la luz entra solo por arriba.
2. **Sala de lectura:** primera cerradura de glifos, segura, con la nota que da la secuencia en la misma sala.
3. **Galería de estanterías:** laberinto de bloques-estantería.
4. **Galería oscura:** con antorcha, dardos y la primera tablilla rota.
5. **Horno de cocer tablillas:** bloque, placa y una cerradura de dos cilindros.
6. **Scriptorium:** la sala más bella, con miles de nichos iluminados por un tragaluz.
7. **Sala del índice:** la secuencia se deduce combinando dos notas.
8. **Canal subterráneo:** la compuerta que inunda la sala del guardián, vista antes de necesitarla.
9. **Sala de Tamrit:** combate y puzle, abrir el agua mientras el guardián persigue.
10. **Sala del Nombre:** reliquia y tres cerraduras a la vez.

**Secretos.** Una estantería que se empuja y revela un nicho. Un saliente sobre el scriptorium al que se llega desde las estanterías altas. Una tablilla en una galería inundable, alcanzable solo antes de abrir el canal.

**Diario.**
- **Nota 1, «El que escribió»:** relieve de Tamrit. Da la primera secuencia de glifos.
- **Nota 2, «Los nombres de los ocho»:** lista tallada con un hueco. Nora reconoce a Qarrum, Nahrem y Ubara.
- **Nota 3, «La palabra sin sonido»:** tablilla sobre la novena puerta. «No se pronuncia: se escribe en la piedra con la luz».

**Luz y arte.** Barro ocre y rojo quemado, polvo en suspensión, haces de tragaluz muy finos y una sensación de biblioteca inmensa. Tablillas instanciadas por miles, con una sola malla y variaciones.

**Trabajo técnico nuevo.**
- Cerradura de glifos en `sim/mechanisms`, con la misma base que el tambor de espejos.
- Trampa de dardos con veneno y aviso visible.
- Guardián de barro con regeneración y vulnerabilidad al agua, sobre la base de `guardian.ts`.
- Relectura de notas desde el diario en pausa, que ya existe.
- Instanciado de tablillas.

---

### V · Las Salas de las Raíces

**Premisa.** Un bosque quedó enterrado cuando la montaña se hundió, y sus raíces han crecido tres mil años a través de la piedra, partiendo las salas. Erreth, la quinta guardiana, "la que brota", no está tallada en piedra: es un árbol petrificado en el centro. Es la cámara más orgánica y la única con color verde.

**Reliquia: la Semilla de Piedra.** Una semilla del tamaño de un puño, de piedra verde, que late caliente cuando la acerca al Corazón. La novena puerta está sellada por raíces vivas, y solo la semilla les pide que se aparten. *Pista:* "Por dónde pasar".

**Mecanismo nuevo: raíces.**
- **Paredes de raíces escalables:** Nora trepa por ellas en las cuatro direcciones (§5, "escalar paredes"). Es el primer muro escalable del juego y se marca con raíces claras y visibles.
- **Raíces que huyen del fuego:** acercar la antorcha encendida a una maraña la hace retraerse, lo que abre pasos y quita asideros. Al apagar o alejar la antorcha, la maraña vuelve a crecer despacio. El puzle combina qué abrir y qué conservar para trepar.

**Recuperado.** La antorcha como herramienta, no solo como luz. El agua de la II en un estanque donde crecen raíces sumergidas.

**Amenazas.**
- **Escorpiones** (§7): pequeños, en grupo y con veneno. Son el enemigo nuevo del acto medio.
- **Suelos de raíz que ceden** bajo el peso, con crujido de madera.
- **Espinos** en fosos, en lugar de estacas.
- **Sin jefe:** el clímax es una escalada por el tronco de Erreth mientras las raíces se cierran detrás.

**Salas (propuesta).**
1. **La grieta:** entrada partida en dos por una raíz gigante.
2. **Primer muro escalable:** seguro, sin caída mortal.
3. **Galería de marañas:** primer uso de la antorcha contra las raíces.
4. **Nido de escorpiones.**
5. **El estanque de raíces:** buceo corto entre raíces sumergidas.
6. **Sala partida:** la mitad de la sala se ha hundido un bloque y medio.
7. **Puente de raíz:** se escala por debajo.
8. **La bóveda del bosque:** vista grande, luz verde filtrada por las grietas.
9. **El tronco de Erreth:** escalada vertical larga y un contrarreloj suave.
10. **Corazón del árbol:** la reliquia.

**Secretos.** Una maraña que solo se abre con la antorcha sostenida desde arriba. Un muro escalable oculto tras una cascada de raíces. Una cámara bajo el estanque.

**Diario.**
- **Nota 1, «Lo que la montaña enterró»:** cómo se hundió el bosque.
- **Nota 2, «Erreth no duerme»:** la guardiana creció en lugar de morir.
- **Nota 3, «La puerta viva»:** la novena está cerrada por raíces y solo la semilla las aparta.

**Luz y arte.** Verde musgo y ámbar, luz de día filtrada en rayos, humedad, hojas petrificadas y raíces con relieve y oclusión fuertes. Es la cámara más cara de modelar: raíces modulares en un kit de piezas.

**Trabajo técnico nuevo.**
- Modo de escalada de pared en `sim/player/modes` (subir, bajar, lateral, saltar a cornisa), con tests de movimiento.
- Actor "maraña" con estados abierta y cerrada según la distancia a la antorcha encendida.
- Escorpiones: nuevo tipo de enemigo con veneno en `actors/enemies`.
- Animaciones de escalada de Mixamo sobre la malla de Nora.
- Kit de raíces en Blender.

---

### VI · La Fragua de Bronce

**Premisa.** Aquí los constructores fundían los sellos de las nueve cámaras. Los canales de fuego están fríos, pero no todos: en el fondo de la montaña aún corre bronce fundido. Bazûr, el sexto guardián, es un autómata de bronce que aún trabaja.

**Reliquia: el Molde del Noveno Segmento.** El molde en el que se fundió cada segmento del sello. Solo falta fundir el noveno, y Nora lo funde en la última sala: la reliquia es la pieza que ella misma saca del molde. *Pista:* "Con qué abrir". Es la llave física.

**Mecanismo nuevo: bronce fundido.**
- **Canales con compuertas:** el bronce fundido corre por canales que se desvían con compuertas. Es la lógica de las compuertas de agua de la II, pero el líquido mata al contacto.
- **Enfriamiento:** el bronce vertido en una zanja se enfría en unos segundos y queda como suelo firme, un puente nuevo. Brilla rojo mientras quema y se oscurece al enfriarse, así que el aviso es visible.
- **Fuelles:** se empujan y arrastran como bloques y avivan las fraguas, que abren puertas por calor.

**Recuperado.** El suelo de fuego del Templo, las placas y los bloques.

**Amenazas.**
- **Autómatas de bronce:** lentos, con coraza, las pistolas apenas los dañan. Se vencen atrayéndolos a un pozo de temple (agua fría) o bajo una colada.
- **Calor:** zonas donde la salud baja despacio fuera de la sombra de los muros, con aviso por distorsión en pantalla y sonido.
- **Bazûr:** jefe en la sala de colada, con fases en las que desvía el bronce hacia Nora.

**Salas (propuesta).**
1. **Galería de moldes fríos.**
2. **Primera colada:** segura, sin caída; se ve cómo el bronce se enfría en puente.
3. **Sala de fuelles.**
4. **Canal principal:** tres compuertas.
5. **Taller de autómatas:** el primero, dormido, despierta al tocar la reliquia de la sala.
6. **Pozo de temple:** el agua fría que vence a los autómatas.
7. **Hornos:** suelo de fuego y calor.
8. **Puente de bronce:** colar, esperar y cruzar antes de que la colada siguiente lo cubra.
9. **Sala de colada:** combate con Bazûr.
10. **El molde del sello:** Nora funde el noveno segmento.

**Secretos.** Un molde con un ídolo dentro que solo se abre al calentarlo. Un conducto de ventilación que se trepa. Una zanja que, bien colada, lleva a una repisa oculta.

**Diario.**
- **Nota 1, «Nueve sellos»:** los constructores fundían cada segmento con el bronce de la cámara anterior.
- **Nota 2, «El que aún trabaja»:** Bazûr.
- **Nota 3, «El noveno no se fundió»:** nadie se atrevió; «lo fundirá quien llegue con las ocho».

**Luz y arte.** Negro y bronce, luz de metal fundido (emisivo intenso, bloom), chispas y distorsión por calor. Es la cámara con más contraste.

**Trabajo técnico nuevo.**
- Líquido letal con nivel y flujo, derivado de `actors/water.ts`.
- Sectores que cambian de mortales a transitables al enfriarse, con test de alcance en el validador.
- Zonas de calor con daño y aviso.
- Autómata: enemigo con coraza y vulnerabilidad al temple.
- Jefe con fases.
- Material emisivo del bronce que se enfría (TSL).

---

### VII · La Escalera del Viento

**Premisa.** Un pozo vertical de ochenta metros atraviesa la montaña entera, de la fragua a la cima. El viento lo recorre, y los constructores tallaron en sus paredes flautas de piedra que cantan cuando pasa. Suhal, el séptimo guardián, "el que canta", es el propio pozo.

**Reliquia: el Caracol del Viento.** Una caracola de bronce que, al soplar el viento, da una sola nota: la que la novena puerta escucha para abrirse. *Pista:* "Qué decirle a la puerta". Se complementa con el nombre de la IV: la palabra se escribe, la nota se toca.

**Mecanismo nuevo: el viento.**
- **Rachas con ritmo** que empujan en horizontal y sostienen en vertical: alargan un salto un bloque o lo acortan.
- **Aviso por sonido:** el tono de las flautas sube antes de cada racha y hay polvo arrastrado. Todo es determinista, con ciclo fijo como las cuchillas del Templo.
- **Palancas de flauta:** abren o cierran tubos, cambian qué rachas soplan y por dónde.

**Recuperado.**
- **Cuerda para tirar** (§8): primera vez que se usa, colgada.
- **Plataformas móviles** del Templo, como contrapesos.
- **Caídas con daño.**

**Amenazas.**
- **Rachas que tiran de las cornisas:** Nora colgada debe esperar el hueco entre dos rachas.
- **Aves de roca** que anidan en el pozo: dos o tres, rápidas, que empujan en lugar de morder.
- **Sin jefe:** el clímax es la subida final con tormenta, rachas más frecuentes y puntos de control seguidos.

**Salas (propuesta).** Todo es vertical, con tramos que dan a salas laterales.
1. **La base del pozo:** desde la fragua, primera racha segura.
2. **Cornisas de la primera flauta.**
3. **Sala de contrapesos:** plataformas móviles.
4. **Primera sala lateral:** palancas de flauta.
5. **El nido.**
6. **Travesía colgada entre rachas.**
7. **Sala de la cuerda.**
8. **La gran flauta:** vista del pozo entero y el canto más fuerte.
9. **Subida con tormenta.**
10. **La cima:** reliquia, y por primera vez el cielo abierto sobre la montaña.

**Secretos.** Un nicho al que solo se llega saltando con una racha a favor. Una flauta que, cerrada, revela un pasadizo detrás. Un nido con un ídolo en lo alto del pozo.

**Diario.**
- **Nota 1, «La montaña respira»:** el pozo conecta el agua de abajo con el cielo de arriba.
- **Nota 2, «Suhal»:** el guardián es el canto.
- **Nota 3, «La nota»:** «la puerta no tiene cerradura: tiene oído».

**Luz y arte.** Piedra gris azulada, luz fría de lo alto que se calienta al subir, polvo y hojas arrastradas por el viento y una vista vertical vertiginosa. La cámara va con mando de cámara especial: vistas verticales y encuadres fijos en la travesía.

**Audio.** Es la cámara donde el sonido es mecánica: las flautas se sintetizan o graban con varias alturas, y hay espacialización vertical.

**Trabajo técnico nuevo.**
- Zonas de viento en `sim` (fuerza por sector y ciclo) con tests de salto: "con racha a favor un salto con carrerilla cruza 3 bloques".
- Cuerda para tirar desde colgada.
- Aves: enemigo que empuja.
- Cámara vertical.
- Audio de flautas ligado a las rachas.

---

### VIII · El Observatorio

**Premisa.** La última cámara conocida: una cúpula tallada en la cima para mirar las estrellas. Su puerta nunca se ha abierto. Anzur, el octavo guardián, "el que mira", es el más grande de los ocho: una figura sentada que sostiene la cúpula y se levanta.

**Reliquia: el Astrolabio de los Nueve.** Un astrolabio de bronce y cristal con encajes para el Corazón (la estrella), el Cristal (la noche) y el Disco (la dirección). Con los tres puestos marca una fecha: la próxima conjunción, dentro de pocos días. *Pista:* "Cuándo exactamente". Es el reloj del final.

**Mecanismo nuevo: la cúpula.** Tres anillos concéntricos que se giran desde palancas en su borde: el cielo (estrellas), la luna (fases) y el horizonte (dirección del sol). La luz entra por un óculo y, cuando los tres anillos están alineados con las pistas de las reliquias I, II y III, cae en el suelo sobre la puerta. Es el puzle que resume la campaña, y quien no recuerde las pistas las tiene en el diario.

**Recuperado.** El haz de luz del Templo, el viento de la VII en la galería exterior, las cerraduras de glifos de la IV para el nombre de Anzur y los bloques.

**Amenazas.** **Anzur**, jefe en tres fases:
1. Barre la cúpula mientras Nora gira un anillo.
2. Rompe el suelo y deja fosos.
3. Solo se detiene cuando la luz alineada le cae encima.

Es el combate más largo y con más puntos de control. Además hay dos o tres chacales en la subida, como eco de la I.

**Salas (propuesta).**
1. **La terraza exterior:** viento, vista de la montaña y del valle, y la puerta cerrada.
2. **Galería de instrumentos.**
3. **Primer anillo:** seguro, enseña a girar.
4. **Sala de las lunas:** las fases talladas.
5. **Sala del horizonte:** marca de la puesta de sol del solsticio.
6. **Las escaleras de la cúpula.**
7. **Bajo la cúpula:** vista y primer encuentro con Anzur.
8. **Combate y alineación.**
9. **El óculo.**
10. **La cámara del astrolabio:** la reliquia.

**Secretos.** Una constelación que, alineada por error, abre un nicho. Un saliente en la cara exterior de la cúpula. Un ídolo en la mano de Anzur, alcanzable solo durante la fase dos.

**Diario.**
- **Nota 1, «El que mira»:** Anzur.
- **Nota 2, «Tres cosas»:** los constructores explican la conjunción con las mismas palabras que Elena.
- **Nota 3, «La novena no es una tumba»:** un aviso.

**Luz y arte.** Noche y bronce: cielo estrellado a través del óculo, luz de luna fría, cúpula tallada con constelaciones. Es la cámara de "vista que obliga a detenerse" por excelencia.

**Trabajo técnico nuevo.**
- Anillos giratorios con estado combinado y validador de alineación.
- Jefe grande en tres fases, sobre la base del guardián del Templo.
- Cielo nocturno con estrellas que coincide con el mapa del Corazón.
- Encajes de las tres reliquias en el astrolabio: inventario entre cámaras, que ya existe como progreso.

---

### IX · La Novena Cámara

**Premisa.** La noche de la conjunción, Nora sigue la dirección del rayo desde la cima hasta una grieta que solo se ve con esa luz. Todo lo aprendido la abre:
- el nombre de la IV, escrito con luz;
- las raíces apartadas con la semilla de la V;
- el segmento fundido de la VI;
- la nota del caracol de la VII;
- el momento que marca el astrolabio de la VIII.

**Qué hay dentro (propuesta de final).** La novena no es la tumba de un guardián: es el lugar donde se elige al noveno. El segmento que falta en el sello no se talló porque se graba con el nombre de quien llega con las ocho reliquias. En 1956 Elena llegó hasta la puerta de la primera cámara y leyó esa promesa en el estrado de Qarrum: por eso dejó el Corazón donde estaba ("no es nuestro") y nunca contó lo que vio. La cámara hace a Nora la misma pregunta que a Elena.

**Final.** Hay dos opciones y la elección es del dueño (ver decisiones).
- **A, un solo final:** Nora devuelve las ocho reliquias a sus pedestales y deja el noveno segmento en blanco, como hizo su abuela. El sello se cierra y la montaña respira. Después de los créditos se ve la firma de Elena, «E. V. — 1956», junto a la de Nora.
- **B, dos finales:** Nora escribe su nombre (el noveno segmento se graba y la montaña la conserva como guardiana) o lo deja en blanco (final A). La elección se hace con Acción ante el sello, sin menú.

**Mecanismo.** Ninguno nuevo: es un recorrido de todos, en orden inverso a la campaña. Tiene viento, raíces, bronce, agua, glifos, espejos, bloques y placas, en salas que recuerdan a cada cámara anterior. Hay poco combate y mucho asombro.

**Amenaza.** La propia cámara: trampas que combinan todo lo anterior. No hay jefe. El último desafío es un recorrido con la luz de la conjunción, que dura poco: un temporizador real pero generoso, con puntos de control cada dos salas.

**Salas (propuesta).**
1. **La grieta del rayo.**
2. **Antesala de los ocho:** ocho estatuas y un pedestal vacío.
3. Una sala por cada cámara anterior (salas 3 a 10):
   - agua que respira;
   - espejos;
   - glifos;
   - raíces;
   - bronce;
   - viento;
   - cúpula;
   - arena.
4. **El sello:** la sala final.

**Secretos.** Uno por cada una de las tres primeras cámaras, escondidos en sus salas-eco: son los tres últimos del juego.

**Diario.**
- **Nota 1, «La promesa»:** la inscripción que leyó Elena.
- **Nota 2, «Carta de Elena, 1956»:** la que nunca envió, escondida en el estrado de Qarrum y que aparece aquí por primera vez. Es la revelación de lo que vio.
- **Nota 3:** la que escribe Nora al final.

**Luz y arte.** Cada sala-eco toma la paleta de su cámara, y la sala del sello es blanca de luz de conjunción: estrella, luna nueva y sol de solsticio a la vez, imposible y deliberado.

**Trabajo técnico nuevo.**
- Temporizador de conjunción, con reglas `wait` y cuenta atrás en el HUD.
- Estado de campaña completo: las ocho reliquias en los pedestales.
- Final con elección si se decide la B.
- Créditos largos con la música del título.

---

### Orden de producción y dependencias

1. **IV · El Archivo.** Reutiliza casi todo (tambor, antorcha, bloques, agua). Necesita cerraduras de glifos, dardos y guardián de barro. Es la de menor riesgo técnico: buena para la versión 0.3.
2. **VI · La Fragua.** Líquido letal y enfriamiento, derivados del agua de la II. Autómatas y jefe.
3. **VII · La Escalera del Viento.** Viento y cuerda: física de salto nueva, con los tests de movimiento más delicados.
4. **V · Las Raíces.** Escalada de pared, que es un modo de movimiento nuevo con animaciones propias, y un kit de arte orgánico caro. Por eso va tras las otras, aunque en la campaña sea la quinta.
5. **VIII · El Observatorio.** Necesita las pistas de I a III y el viento de la VII. Tiene el jefe más grande.
6. **IX · La Novena Cámara.** Necesita todo lo anterior.

Se pueden construir fuera de orden porque cada cámara carga por URL (`?level=`) y el progreso las abre en orden de campaña. El mapa de cámaras ya muestra IV a VIII selladas y IX sin encontrar.

**Mecánicas nuevas por prioridad técnica.**
- En `sim` y con tests de movimiento: escalada de pared y viento.
- Actores nuevos: cerraduras de glifos, dardos, líquido letal con enfriamiento, marañas de raíces y anillos giratorios.
- Enemigos nuevos: escorpiones, autómatas y aves.
- Tres jefes: Tamrit, Bazûr y Anzur.

### Decisiones abiertas de las cámaras IV a IX

- [ ] ¿Final único (A) o dos finales con elección (B)?
- [ ] ¿Se reordena la campaña para que la V (escalada) no sea la quinta, o se mantiene el orden narrativo y se construye más tarde?
- [ ] ¿La novena tiene temporizador real, o el plazo de la conjunción es solo narrativo?
- [ ] Nombres definitivos de los guardianes IV a VIII y de las reliquias.
- [ ] ¿La carta de Elena de 1956 se muestra al final, o se deja la revelación implícita?
- [ ] Presupuesto de arte: la V (raíces) y la VIII (cúpula y jefe grande) son las más caras de modelar.
