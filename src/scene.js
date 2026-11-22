import { createProjectCardTexture } from './textures.js';
import { loadSTLGeometry } from './stl.js';

const THREE_SOURCES = [
  'three',
  'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
  'https://unpkg.com/three@0.170.0/build/three.module.js',
  'https://esm.sh/three@0.170.0'
];

/**
 * Loads Three.js dynamically with CDN fallbacks so a blocked/offline CDN
 * never breaks the rest of the page's UI and navigation.
 */
export async function loadThree() {
  let lastError = null;
  for (const src of THREE_SOURCES) {
    try {
      const mod = await import(src);
      if (mod && mod.WebGLRenderer && mod.Scene) {
        return mod;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Unable to load Three.js from any CDN');
}

/**
 * Builds the 3D `.stl` display slot for a card. Shows a subtle wireframe spinner
 * while fetching, then mounts the normalized `.stl` geometry once loaded.
 */
function createSTLHolder(THREE, project, projectIndex) {
  const group = new THREE.Group();
  const innerGroup = new THREE.Group();
  group.add(innerGroup);

  const accentColor = new THREE.Color(project.accent || '#38bdf8');
  const baseColor = new THREE.Color(project.stlColor || '#d8e2f0').lerp(accentColor, 0.25);

  const stlMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: accentColor,
    emissiveIntensity: 0.14,
    metalness: 0.55,
    roughness: 0.28,
    flatShading: false
  });

  // Lightweight placeholder spinner while the .stl downloads
  const loaderRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.32, 0.018, 10, 36),
    new THREE.MeshBasicMaterial({
      color: accentColor,
      wireframe: true,
      transparent: true,
      opacity: 0.65
    })
  );
  loaderRing.userData.projectIndex = projectIndex;
  innerGroup.add(loaderRing);

  let disposed = false;

  if (project.stlUrl) {
    loadSTLGeometry(THREE, project.stlUrl)
      .then((geometry) => {
        if (disposed) return;

        innerGroup.remove(loaderRing);
        loaderRing.geometry.dispose();
        loaderRing.material.dispose();

        const mesh = new THREE.Mesh(geometry, stlMat);
        mesh.userData.sharedGeo = true;
        mesh.userData.projectIndex = projectIndex;

        if (Array.isArray(project.stlRotation)) {
          mesh.rotation.set(
            project.stlRotation[0] || 0,
            project.stlRotation[1] || 0,
            project.stlRotation[2] || 0
          );
        }

        const scale = typeof project.stlScale === 'number' ? project.stlScale : 1;
        mesh.scale.setScalar(scale);

        if (project.stlWireframe) {
          const wire = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: accentColor,
              wireframe: true,
              transparent: true,
              opacity: 0.25
            })
          );
          wire.userData.sharedGeo = true;
          wire.userData.projectIndex = projectIndex;
          wire.scale.setScalar(1.003);
          mesh.add(wire);
        }

        innerGroup.add(mesh);
      })
      .catch((err) => {
        console.warn(`Could not load STL for "${project.title}":`, err);
      });
  }

  const update = (t, dt, speed) => {
    innerGroup.rotation.y += dt * 0.68 * speed;
    innerGroup.rotation.x = Math.sin(t * 0.85) * 0.1;
  };

  const markDisposed = () => {
    disposed = true;
  };

  return { group, update, markDisposed };
}

function disposeObjectTree(root) {
  root.traverse((obj) => {
    if (obj.geometry && !obj.userData?.sharedGeo) {
      obj.geometry.dispose();
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

export class ShowcaseScene {
  constructor(THREE, container, { onSelectIndex, onInspectIndex, onHoverChange } = {}) {
    this.THREE = THREE;
    this.container = container;
    this.onSelectIndex = onSelectIndex || (() => {});
    this.onInspectIndex = onInspectIndex || (() => {});
    this.onHoverChange = onHoverChange || (() => {});

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.projects = [];
    this.cards = [];

    this.targetIndex = 0;
    this.springPos = 0;
    this.springVel = 0;

    this.isInspecting = false;
    this.inspectProgress = 0;
    this.inspectYaw = 0;
    this.inspectPitch = 0;

    this.pointer = new THREE.Vector2(0, 0);
    this.smoothPointer = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.hoveredIndex = -1;

    this.targetAccent = new THREE.Color('#38bdf8');
    this.currentAccent = new THREE.Color('#38bdf8');

    this._drag = {
      active: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      moved: 0
    };

    this._clock = new THREE.Clock();
    this._rafId = null;
    this._disposed = false;

    this._initRenderer();
    this._initEnvironment();
    this._bindEvents();
    this._animate();
  }

  _initRenderer() {
    const THREE = this.THREE;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060a');
    this.scene.fog = new THREE.FogExp2('#05060a', 0.065);

    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 80);
    this.camera.position.set(0, 0.35, 7.6);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.container.appendChild(this.renderer.domElement);
  }

  _initEnvironment() {
    const THREE = this.THREE;

    const ambient = new THREE.AmbientLight(0xdbeafe, 0.85);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(4, 6, 7);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.25);
    rimLight.position.set(-5, 3, -4);
    this.scene.add(rimLight);

    this.accentLight = new THREE.PointLight(0x38bdf8, 6.5, 16, 1.6);
    this.accentLight.position.set(0, 1.1, 3.2);
    this.scene.add(this.accentLight);

    this.grid = new THREE.GridHelper(48, 48, 0x263248, 0x111726);
    this.grid.position.y = -2.25;
    this.scene.add(this.grid);

    const floorGeo = new THREE.PlaneGeometry(48, 48);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x05070c,
      metalness: 0.4,
      roughness: 0.75
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -2.26;
    this.scene.add(floor);

    const moteCount = 160;
    const motePos = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      motePos[i * 3] = (Math.random() - 0.5) * 26;
      motePos[i * 3 + 1] = Math.random() * 9 - 2;
      motePos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 3;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.045,
      transparent: true,
      opacity: 0.55
    });
    this.motes = new THREE.Points(moteGeo, moteMat);
    this.scene.add(this.motes);

    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);
  }

  setProjects(projects, initialIndex = 0) {
    const THREE = this.THREE;
    for (const card of this.cards) {
      card.artifact.markDisposed();
      this.stageGroup.remove(card.root);
      disposeObjectTree(card.root);
    }
    this.cards = [];
    this.projects = projects;

    const cardGeo = new THREE.BoxGeometry(2.55, 3.2, 0.14);
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x0d121d,
      metalness: 0.7,
      roughness: 0.3
    });

    projects.forEach((project, idx) => {
      const root = new THREE.Group();
      root.userData.projectIndex = idx;

      const texture = createProjectCardTexture(THREE, project, idx, projects.length);
      const frontMat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.38,
        metalness: 0.12
      });

      const monolith = new THREE.Mesh(cardGeo, [
        sideMat,
        sideMat,
        sideMat,
        sideMat,
        frontMat,
        sideMat
      ]);
      monolith.userData.projectIndex = idx;
      root.add(monolith);

      const barGeo = new THREE.BoxGeometry(1.75, 0.035, 0.06);
      const barMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(project.accent || '#38bdf8')
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(0, -1.72, 0.08);
      root.add(bar);

      const artifact = createSTLHolder(THREE, project, idx);
      artifact.group.position.set(0, 0.28, 0.82);
      root.add(artifact.group);

      this.stageGroup.add(root);
      this.cards.push({
        project,
        root,
        monolith,
        artifact,
        hoverAmount: 0
      });
    });

    const clamped = Math.max(0, Math.min(initialIndex, Math.max(0, projects.length - 1)));
    this.targetIndex = clamped;
    this.springPos = clamped;
    this.springVel = 0;

    if (projects[clamped]) {
      this.targetAccent.set(projects[clamped].accent || '#38bdf8');
      this.currentAccent.copy(this.targetAccent);
    }
  }

  setActiveIndex(index) {
    if (!this.projects.length) return;
    const clamped = Math.max(0, Math.min(index, this.projects.length - 1));
    this.targetIndex = clamped;
    this.targetAccent.set(this.projects[clamped].accent || '#38bdf8');
    this.inspectYaw = 0;
    this.inspectPitch = 0;
  }

  setInspecting(inspecting) {
    this.isInspecting = inspecting;
    if (!inspecting) {
      this.inspectYaw = 0;
      this.inspectPitch = 0;
    }
  }

  _bindEvents() {
    this._onResize = () => {
      if (this._disposed) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };

    this._onPointerDown = (e) => {
      this._drag.active = true;
      this._drag.startX = e.clientX;
      this._drag.startY = e.clientY;
      this._drag.lastX = e.clientX;
      this._drag.lastY = e.clientY;
      this._drag.moved = 0;
    };

    this._onPointerMove = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!this._drag.active) return;

      const dx = e.clientX - this._drag.lastX;
      const dy = e.clientY - this._drag.lastY;
      this._drag.lastX = e.clientX;
      this._drag.lastY = e.clientY;
      this._drag.moved += Math.hypot(dx, dy);

      if (this.isInspecting) {
        this.inspectYaw += dx * 0.011;
        this.inspectPitch = Math.max(-0.65, Math.min(0.65, this.inspectPitch + dy * 0.009));
      }
    };

    this._onPointerUp = (e) => {
      if (!this._drag.active) return;
      const totalDx = e.clientX - this._drag.startX;
      const moved = this._drag.moved;
      this._drag.active = false;

      if (!this.isInspecting && Math.abs(totalDx) > 48) {
        if (totalDx < 0 && this.targetIndex < this.projects.length - 1) {
          this.onSelectIndex(this.targetIndex + 1);
        } else if (totalDx > 0 && this.targetIndex > 0) {
          this.onSelectIndex(this.targetIndex - 1);
        }
        return;
      }

      if (moved < 9) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const hitIdx = this._pickCardIndex();
        if (hitIdx !== -1) {
          if (hitIdx === this.targetIndex) {
            this.onInspectIndex(hitIdx);
          } else {
            this.onSelectIndex(hitIdx);
          }
        }
      }
    };

    window.addEventListener('resize', this._onResize);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  _pickCardIndex() {
    if (!this.cards.length) return -1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = this.cards.map((c) => c.root);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (!hits.length) return -1;
    let obj = hits[0].object;
    while (obj) {
      if (typeof obj.userData?.projectIndex === 'number') {
        return obj.userData.projectIndex;
      }
      obj = obj.parent;
    }
    return -1;
  }

  _animate() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(() => this._animate());

    const dt = Math.min(this._clock.getDelta(), 0.05);
    const elapsed = this._clock.elapsedTime;
    const motionFactor = this.reducedMotion ? 0.2 : 1;

    const stiffness = 240;
    const damping = 28;
    const force = (this.targetIndex - this.springPos) * stiffness;
    this.springVel += (force - this.springVel * damping) * dt;
    this.springPos += this.springVel * dt;

    this.smoothPointer.lerp(this.pointer, 1 - Math.exp(-8 * dt));

    const targetInspect = this.isInspecting ? 1 : 0;
    this.inspectProgress += (targetInspect - this.inspectProgress) * (1 - Math.exp(-10 * dt));

    this.currentAccent.lerp(this.targetAccent, 1 - Math.exp(-8 * dt));
    this.accentLight.color.copy(this.currentAccent);

    let nextHover = -1;
    if (!this._drag.active) {
      nextHover = this._pickCardIndex();
    }
    if (nextHover !== this.hoveredIndex) {
      this.hoveredIndex = nextHover;
      this.renderer.domElement.style.cursor =
        this.isInspecting ? 'grab' : nextHover !== -1 ? 'pointer' : 'default';
      this.onHoverChange(nextHover);
    } else if (this.isInspecting) {
      this.renderer.domElement.style.cursor = this._drag.active ? 'grabbing' : 'grab';
    }

    const isWide = window.innerWidth > 980;
    const inspectShiftX = isWide ? 1.45 * this.inspectProgress : 0;
    const camZ = 7.5 - this.inspectProgress * 2.15;
    const camY = 0.25 + this.inspectProgress * 0.12;

    this.camera.position.x =
      inspectShiftX + this.smoothPointer.x * 0.32 * (1 - this.inspectProgress * 0.6);
    this.camera.position.y =
      camY + this.smoothPointer.y * 0.18 * (1 - this.inspectProgress * 0.6);
    this.camera.position.z = camZ;
    this.camera.lookAt(inspectShiftX * 0.72, 0.05, 0);

    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const offset = i - this.springPos;
      const absOffset = Math.abs(offset);
      const isFocused = i === this.targetIndex;
      const isHovered = i === this.hoveredIndex;

      const hoverTarget = isHovered ? 1 : 0;
      card.hoverAmount += (hoverTarget - card.hoverAmount) * (1 - Math.exp(-12 * dt));

      const spacing = 3.55;
      const x = offset * spacing;
      const z = -Math.pow(absOffset, 1.15) * 1.45 + card.hoverAmount * 0.22;
      const floatY = Math.sin(elapsed * 1.4 + i * 1.2) * 0.055 * motionFactor;
      const y = -absOffset * 0.08 + floatY + card.hoverAmount * 0.08;

      const baseScale = Math.max(0.7, 1 - absOffset * 0.14);
      const scale = baseScale + card.hoverAmount * 0.035;

      card.root.position.set(x, y, z);
      card.root.scale.setScalar(scale);

      const arcRotY = -offset * 0.24;
      const pointerTiltY = isFocused ? this.smoothPointer.x * 0.09 * (1 - this.inspectProgress) : 0;
      const pointerTiltX = isFocused ? -this.smoothPointer.y * 0.06 * (1 - this.inspectProgress) : 0;

      card.root.rotation.y = arcRotY + pointerTiltY;
      card.root.rotation.x = pointerTiltX;

      if (this.inspectProgress > 0.01 && !isFocused) {
        card.root.position.z -= this.inspectProgress * 2.4;
      }

      const spinSpeed = (isHovered ? 1.6 : isFocused ? 1.15 : 0.65) * motionFactor;
      card.artifact.update(elapsed, dt, spinSpeed);

      if (isFocused) {
        const orbitEase = 1 - Math.exp(-10 * dt);
        card.artifact.group.rotation.y += (this.inspectYaw - card.artifact.group.rotation.y) * orbitEase;
        card.artifact.group.rotation.x += (this.inspectPitch - card.artifact.group.rotation.x) * orbitEase;
        card.artifact.group.position.z = 0.82 + this.inspectProgress * 0.42;
        card.artifact.group.scale.setScalar(1 + this.inspectProgress * 0.18);
      } else {
        const resetEase = 1 - Math.exp(-8 * dt);
        card.artifact.group.rotation.y += (0 - card.artifact.group.rotation.y) * resetEase;
        card.artifact.group.rotation.x += (0 - card.artifact.group.rotation.x) * resetEase;
        card.artifact.group.position.z = 0.82;
        card.artifact.group.scale.setScalar(1);
      }
    }

    this.motes.rotation.y = elapsed * 0.018 * motionFactor;

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    for (const card of this.cards) {
      card.artifact.markDisposed();
      disposeObjectTree(card.root);
    }
    this.renderer.dispose();
  }
}
