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
