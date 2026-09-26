/**
 * Milestone 1 renderer: a floor with a 2 m block grid, a few reference pillars
 * and the box character. Interpolates between the previous and current state.
 */
import * as THREE from 'three/webgpu';
import type { Vec3 } from '../sim/world';
import { tuning } from '../sim/player/tuning';

const BLOCK = 2;

export interface PlayerPose {
  pos: Vec3;
  yaw: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  private readonly player = new THREE.Group();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.shadowMap.enabled = true;

    this.scene.background = new THREE.Color('#1a130d');
    this.scene.fog = new THREE.Fog('#1a130d', 14, 48);

    this.buildRoom();
    this.buildPlayer();
    this.resize();
  }

  async init(): Promise<void> {
    await this.renderer.init();
  }

  /** 'WebGPU' or 'WebGL2', depending on the backend Three.js picked. */
  get backendName(): string {
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  }

  private buildRoom(): void {
    const size = 12; // blocks per side
    const floorTex = gridTexture();
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(size, size);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size * BLOCK, size * BLOCK),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Pillars on block corners to read the scale.
    const stone = new THREE.MeshStandardMaterial({ color: '#8a7355', roughness: 0.85 });
    const pillarGeo = new THREE.BoxGeometry(BLOCK, BLOCK * 2, BLOCK);
    const spots: [number, number][] = [
      [-4, -4],
      [4, -4],
      [-4, 4],
      [4, 4],
      [0, -8],
    ];
    const pillars = new THREE.InstancedMesh(pillarGeo, stone, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x * BLOCK + BLOCK / 2, BLOCK, z * BLOCK + BLOCK / 2);
      pillars.setMatrixAt(i, m);
    });
    pillars.castShadow = pillars.receiveShadow = true;
    this.scene.add(pillars);

    this.scene.add(new THREE.HemisphereLight('#8fa3c0', '#3a2616', 0.9));
    const sun = new THREE.DirectionalLight('#d8e4ff', 1.4);
    sun.position.set(-8, 18, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -16;
    s.right = s.top = 16;
    this.scene.add(sun);

    const fire = new THREE.PointLight('#ff9a4a', 60, 16, 2);
    fire.position.set(1, 2.2, -13);
    this.scene.add(fire);
  }

  private buildPlayer(): void {
    // Placeholder box character (spec §11): body + head + nose to show facing.
    const w = tuning.radius * 2;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, tuning.height * 0.78, w * 0.7),
      new THREE.MeshStandardMaterial({ color: '#4f6b5a', roughness: 0.7 }),
    );
    body.position.y = tuning.height * 0.39;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.6, tuning.height * 0.2, w * 0.6),
      new THREE.MeshStandardMaterial({ color: '#c89a78', roughness: 0.6 }),
    );
    head.position.y = tuning.height * 0.88;
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.14),
      new THREE.MeshStandardMaterial({ color: '#c89a78' }),
    );
    nose.position.set(0, tuning.height * 0.88, -w * 0.35);
    for (const part of [body, head, nose]) {
      part.castShadow = true;
      this.player.add(part);
    }
    this.scene.add(this.player);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(prev: PlayerPose, curr: PlayerPose, alpha: number, eye: Vec3, target: Vec3): void {
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    this.player.position.set(
      lerp(prev.pos.x, curr.pos.x),
      lerp(prev.pos.y, curr.pos.y),
      lerp(prev.pos.z, curr.pos.z),
    );
    let dy = curr.yaw - prev.yaw;
    if (dy > Math.PI) dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    this.player.rotation.y = prev.yaw + dy * alpha;

    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.lookAt(target.x, target.y, target.z);
    this.renderer.render(this.scene, this.camera);
  }
}

/** Canvas-generated grid texture: one 2 m block per repeat. */
function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D not available');
  g.fillStyle = '#6b5842';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#4a3b2b';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 125);
  // Click marks (0.5 m).
  g.strokeStyle = 'rgba(74, 59, 43, 0.35)';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32, 128);
    g.moveTo(0, i * 32);
    g.lineTo(128, i * 32);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}
