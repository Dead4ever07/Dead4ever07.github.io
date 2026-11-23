import {
  createGalleryFloorTexture,
  createGalleryWallTexture,
  createSoftShadowTexture,
  createStandPlaqueTexture,
  createWallArtworkTexture
} from './textures.js';
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
 * Builds the 3D `.stl` artifact display mount inside a museum vitrine.
 * Shows a subtle brass loader ring while fetching, then mounts the normalized `.stl`.
 */
function createSTLHolder(THREE, project, projectIndex) {
  const group = new THREE.Group();

  const orbitGroup = new THREE.Group();
  orbitGroup.position.y = 1.99;
  group.add(orbitGroup);

  const innerGroup = new THREE.Group();
  orbitGroup.add(innerGroup);

  const accentColor = new THREE.Color(project.accent || '#2f7f5f');
  const baseColor = new THREE.Color(project.stlColor || '#cfd6de').lerp(accentColor, 0.22);

  const stlMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: 0.45,
    roughness: 0.34,
    flatShading: false
  });

  const loaderRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.015, 10, 32),
    new THREE.MeshStandardMaterial({
      color: 0xd4a359,
      metalness: 0.7,
      roughness: 0.3
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
        mesh.renderOrder = 1;
        // Skip raycasting the 100k+ triangle STL mesh; the stand hitbox handles picking at 60fps
        mesh.raycast = () => {};

        if (Array.isArray(project.stlRotation)) {
          mesh.rotation.set(
            project.stlRotation[0] || 0,
            project.stlRotation[1] || 0,
            project.stlRotation[2] || 0
          );
        }

        // Fit comfortably inside the 1.26m glass vitrine
        const scale = 0.74 * (typeof project.stlScale === 'number' ? project.stlScale : 1);
        mesh.scale.setScalar(scale);

        if (project.stlWireframe) {
          const wire = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
              color: accentColor,
              wireframe: true,
              transparent: true,
              opacity: 0.22
            })
          );
          wire.userData.sharedGeo = true;
          wire.userData.projectIndex = projectIndex;
          wire.raycast = () => {};
          wire.scale.setScalar(1.003);
          mesh.add(wire);
        }

        innerGroup.add(mesh);
      })
      .catch((err) => {
        console.warn(`Could not load STL for "${project.title}":`, err);
      });
  }

  const update = (elapsed, dt, speed, inspectProgress, motionFactor) => {
    innerGroup.rotation.y += dt * 0.42 * speed;
    orbitGroup.position.y =
      1.99 + Math.sin(elapsed * 1.15 + projectIndex) * 0.014 * motionFactor * (1 - inspectProgress);
  };

  const markDisposed = () => {
    disposed = true;
  };

  return { group, orbitGroup, update, markDisposed };
}

function disposeObjectTree(root, sharedMaterials, sharedTextures) {
  root.traverse((obj) => {
    if (obj.geometry && !obj.userData?.sharedGeo) {
      obj.geometry.dispose();
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (sharedMaterials?.has(m)) continue;
        if (m.map && !sharedTextures?.has(m.map)) {
          m.map.dispose();
        }
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
    this.stands = [];
    this.roomDynamicGroup = null;

    this.standRadius = 5.6;
    this.roomRadius = 10.6;

    this.targetIndex = 0;
    this.targetAngle = 0;
    this.camAngle = 0;
    this.camAngularVel = 0;

    this.isInspecting = false;
    this.inspectProgress = 0;
    this.inspectYaw = 0;
    this.inspectPitch = 0;

    this.pointer = new THREE.Vector2(0, 0);
    this.smoothPointer = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.hoveredIndex = -1;

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

    this._sharedMaterials = new Set();
    this._sharedTextures = new Set();

    this._initRenderer();
    this._initSharedAssets();
    this._initLighting();
    this.container.appendChild(this.renderer.domElement);
    this._bindEvents();
    this._animate();
  }

  _initRenderer() {
    const THREE = this.THREE;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#201c18');
    this.scene.fog = new THREE.Fog('#201c18', 17, 38);

    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 60);
    this.camera.position.set(0, 1.84, -1.4);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
  }

  _initSharedAssets() {
    const THREE = this.THREE;
    this.floorTexture = createGalleryFloorTexture(THREE);
    this.wallTexture = createGalleryWallTexture(THREE);
    this.shadowTexture = createSoftShadowTexture(THREE);
    this._sharedTextures.add(this.floorTexture);
    this._sharedTextures.add(this.wallTexture);
    this._sharedTextures.add(this.shadowTexture);

    this.walnutMat = new THREE.MeshStandardMaterial({
      color: 0x261f19,
      roughness: 0.58,
      metalness: 0.08
    });

    this.darkStoneMat = new THREE.MeshStandardMaterial({
      color: 0x1b1815,
      roughness: 0.72,
      metalness: 0.06
    });

    this.velvetMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f1d,
      roughness: 0.92,
      metalness: 0.02
    });

    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xc89b54,
      roughness: 0.32,
      metalness: 0.82
    });

    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xf0f5fa,
      transparent: true,
      opacity: 0.14,
      roughness: 0.06,
      metalness: 0.12,
      reflectivity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.wallMat = new THREE.MeshStandardMaterial({
      map: this.wallTexture,
      color: 0xd9cfc0,
      roughness: 0.88,
      metalness: 0.02
    });

    this.wainscotMat = new THREE.MeshStandardMaterial({
      color: 0xbcb09e,
      roughness: 0.84,
      metalness: 0.03
    });

    this.pilasterMat = new THREE.MeshStandardMaterial({
      color: 0xc9beae,
      roughness: 0.76,
      metalness: 0.04
    });

    this.floorMat = new THREE.MeshStandardMaterial({
      map: this.floorTexture,
      roughness: 0.52,
      metalness: 0.06
    });

    for (const mat of [
      this.walnutMat,
      this.darkStoneMat,
      this.velvetMat,
      this.brassMat,
      this.glassMat,
      this.wallMat,
      this.wainscotMat,
      this.pilasterMat,
      this.floorMat
    ]) {
      this._sharedMaterials.add(mat);
    }

    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);

    this.standsGroup = new THREE.Group();
    this.scene.add(this.standsGroup);
  }

  _initLighting() {
    const THREE = this.THREE;

    // Warm gallery skylight + oak floor bounce fill
    const hemi = new THREE.HemisphereLight(0xfff4e2, 0x564332, 1.12);
    this.scene.add(hemi);

    // Soft daylight pouring through central skylight oculus
    const oculusSun = new THREE.DirectionalLight(0xfff7ea, 1.4);
    oculusSun.position.set(2.4, 8.5, 3.2);
    this.scene.add(oculusSun);

    // Subtle cool counter-fill for metallic/PCB contours
    const coolFill = new THREE.DirectionalLight(0xd9e4f0, 0.55);
    coolFill.position.set(-4.2, 4.8, -3.5);
    this.scene.add(coolFill);

    // Active stand museum track spotlight
    this.standSpot = new THREE.SpotLight(0xffe6bd, 18, 15, Math.PI * 0.22, 0.68, 1.4);
    this.standSpot.position.set(0, 5.4, -3.8);
    this.standSpotTarget = new THREE.Object3D();
    this.scene.add(this.standSpotTarget);
    this.standSpot.target = this.standSpotTarget;
    this.scene.add(this.standSpot);

    // Active vitrine interior jewel light
    this.vitrineLight = new THREE.PointLight(0xfff4de, 2.4, 4.2, 1.6);
    this.vitrineLight.position.set(0, 2.52, -5.6);
    this.scene.add(this.vitrineLight);
  }

  _buildMuseumRoom(standAngles) {
    const THREE = this.THREE;

    if (this.roomDynamicGroup) {
      this.roomGroup.remove(this.roomDynamicGroup);
      disposeObjectTree(this.roomDynamicGroup, this._sharedMaterials, this._sharedTextures);
    }

    const group = new THREE.Group();
    this.roomDynamicGroup = group;

    const R = this.roomRadius;
    const H = 6.6;
    const sides = 12;

    // 1. Herringbone parquet floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.5, 48), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    group.add(floor);

    // Inlaid brass floor rings & central compass medallion
    const ringRadii = [1.25, 3.65, this.standRadius + 1.35];
    for (const rr of ringRadii) {
      const inlay = new THREE.Mesh(
        new THREE.RingGeometry(rr - 0.025, rr + 0.025, 64),
        this.brassMat
      );
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.y = 0.004;
      group.add(inlay);
    }

    const centerDisc = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 32), this.brassMat);
    centerDisc.rotation.x = -Math.PI / 2;
    centerDisc.position.y = 0.004;
    group.add(centerDisc);

    // 2. 12-sided architectural gallery walls + pilasters + recessed moldings + framed art
    const apothem = R * Math.cos(Math.PI / sides);
    const bayWidth = 2 * R * Math.sin(Math.PI / sides);
    const innerPanelW = bayWidth - 0.95;

    for (let i = 0; i < sides; i++) {
      // Align wall bay centers with cardinal angles (0°, 30°, 60°, 90°...) behind the stands
      const a = (i / sides) * Math.PI * 2;
      const wallBay = new THREE.Group();
      wallBay.rotation.y = -a;

      // Main limewash plaster wall panel
      const wallPanel = new THREE.Mesh(new THREE.PlaneGeometry(bayWidth + 0.06, H), this.wallMat);
      wallPanel.position.set(0, H / 2, -apothem);
      wallBay.add(wallPanel);

      // Dark walnut baseboard molding + subtle brass kick strip
      const baseboard = new THREE.Mesh(
        new THREE.BoxGeometry(bayWidth + 0.06, 0.32, 0.12),
        this.walnutMat
      );
      baseboard.position.set(0, 0.16, -apothem + 0.05);
      wallBay.add(baseboard);

      const baseBrassTrim = new THREE.Mesh(
        new THREE.BoxGeometry(bayWidth + 0.04, 0.025, 0.13),
        this.brassMat
      );
      baseBrassTrim.position.set(0, 0.32, -apothem + 0.055);
      wallBay.add(baseBrassTrim);

      // Lower wainscoting inset panel & raised trim frame
      const wainscotBg = new THREE.Mesh(
        new THREE.BoxGeometry(innerPanelW, 0.68, 0.03),
        this.wainscotMat
      );
      wainscotBg.position.set(0, 0.78, -apothem + 0.015);
      wallBay.add(wainscotBg);

      const wTop = new THREE.Mesh(new THREE.BoxGeometry(innerPanelW + 0.1, 0.06, 0.06), this.pilasterMat);
      wTop.position.set(0, 1.13, -apothem + 0.03);
      const wBot = new THREE.Mesh(new THREE.BoxGeometry(innerPanelW + 0.1, 0.06, 0.06), this.pilasterMat);
      wBot.position.set(0, 0.43, -apothem + 0.03);
      const wLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), this.pilasterMat);
      wLeft.position.set(-innerPanelW / 2 - 0.02, 0.78, -apothem + 0.03);
      const wRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), this.pilasterMat);
      wRight.position.set(innerPanelW / 2 + 0.02, 0.78, -apothem + 0.03);
      wallBay.add(wTop, wBot, wLeft, wRight);

      // Stepped chair rail molding
      const chairRail = new THREE.Mesh(
        new THREE.BoxGeometry(bayWidth + 0.04, 0.085, 0.11),
        this.pilasterMat
      );
      chairRail.position.set(0, 1.28, -apothem + 0.045);
      wallBay.add(chairRail);

      // Upper architectural wall panel molding frame
      const upperFrameW = innerPanelW - 0.1;
      const upperTop = new THREE.Mesh(new THREE.BoxGeometry(upperFrameW + 0.1, 0.065, 0.055), this.pilasterMat);
      upperTop.position.set(0, 5.45, -apothem + 0.025);
      const upperBot = new THREE.Mesh(new THREE.BoxGeometry(upperFrameW + 0.1, 0.065, 0.055), this.pilasterMat);
      upperBot.position.set(0, 1.62, -apothem + 0.025);
      const upperLeft = new THREE.Mesh(new THREE.BoxGeometry(0.065, 3.88, 0.055), this.pilasterMat);
      upperLeft.position.set(-upperFrameW / 2 - 0.02, 3.535, -apothem + 0.025);
      const upperRight = new THREE.Mesh(new THREE.BoxGeometry(0.065, 3.88, 0.055), this.pilasterMat);
      upperRight.position.set(upperFrameW / 2 + 0.02, 3.535, -apothem + 0.025);
      wallBay.add(upperTop, upperBot, upperLeft, upperRight);

      // Stepped upper crown cornice entablature
      const corniceLower = new THREE.Mesh(
        new THREE.BoxGeometry(bayWidth + 0.06, 0.14, 0.18),
        this.pilasterMat
      );
      corniceLower.position.set(0, H - 0.28, -apothem + 0.08);
      wallBay.add(corniceLower);

      const cornice = new THREE.Mesh(
        new THREE.BoxGeometry(bayWidth + 0.06, 0.22, 0.28),
        this.pilasterMat
      );
      cornice.position.set(0, H - 0.11, -apothem + 0.12);
      wallBay.add(cornice);

      // Check if a stand sits directly in front of this bay
      const hasStand = standAngles.some((sa) => {
        const diff = Math.atan2(Math.sin(sa - a), Math.cos(sa - a));
        return Math.abs(diff) < 0.22;
      });

      // Alternate between framed technical museum prints and brass gallery wall sconces on open bays
      if (!hasStand && i % 2 === 1) {
        const frameGroup = new THREE.Group();
        frameGroup.position.set(0, 3.35, -apothem + 0.05);

        const outerFrame = new THREE.Mesh(
          new THREE.BoxGeometry(1.52, 1.88, 0.06),
          this.walnutMat
        );
        frameGroup.add(outerFrame);

        const artTex = createWallArtworkTexture(THREE, Math.floor(i / 2));
        const artPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(1.36, 1.7),
          new THREE.MeshStandardMaterial({
            map: artTex,
            roughness: 0.6,
            metalness: 0.05
          })
        );
        artPlane.position.z = 0.034;
        frameGroup.add(artPlane);

        const lightBar = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.04, 0.14),
          this.brassMat
        );
        lightBar.position.set(0, 1.06, 0.08);
        frameGroup.add(lightBar);

        wallBay.add(frameGroup);
      } else if (!hasStand && i % 2 === 0) {
        // Warm brass museum wall sconce
        const sconceGroup = new THREE.Group();
        sconceGroup.position.set(0, 3.25, -apothem + 0.06);

        const backplate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.11, 0.11, 0.03, 20),
          this.brassMat
        );
        backplate.rotation.x = Math.PI / 2;
        sconceGroup.add(backplate);

        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.03, 0.16),
          this.brassMat
        );
        arm.position.set(0, 0, 0.08);
        sconceGroup.add(arm);

        const shade = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.14, 0.24, 20, 1, true),
          new THREE.MeshStandardMaterial({
            color: 0xf7ecd7,
            emissive: 0xffe0a6,
            emissiveIntensity: 0.45,
            roughness: 0.5,
            side: THREE.DoubleSide
          })
        );
        shade.position.set(0, 0.12, 0.16);
        sconceGroup.add(shade);

        wallBay.add(sconceGroup);
      }

      group.add(wallBay);

      // Architectural stepped column pilaster flanking each bay (15°, 45°, 75°...)
      const cornerA = ((i + 0.5) / sides) * Math.PI * 2;
      const px = Math.sin(cornerA) * (R - 0.16);
      const pz = -Math.cos(cornerA) * (R - 0.16);

      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.44, H - 0.3, 0.44), this.pilasterMat);
      pilaster.position.set(px, H / 2, pz);
      pilaster.rotation.y = -cornerA;
      group.add(pilaster);

      const pilasterBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.36, 0.56),
        this.darkStoneMat
      );
      pilasterBase.position.set(px, 0.18, pz);
      pilasterBase.rotation.y = -cornerA;
      group.add(pilasterBase);

      const pilasterCapital = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.24, 0.56),
        this.pilasterMat
      );
      pilasterCapital.position.set(px, H - 0.24, pz);
      pilasterCapital.rotation.y = -cornerA;
      group.add(pilasterCapital);
    }

    // 3. Coffered gallery ceiling with central circular skylight oculus & radial beams
    const oculusR = 3.2;
    const ceilingRing = new THREE.Mesh(
      new THREE.RingGeometry(oculusR, R + 0.6, 48),
      this.wallMat
    );
    ceilingRing.rotation.x = Math.PI / 2;
    ceilingRing.position.y = H;
    group.add(ceilingRing);

    // 12 radial ceiling coffer beams connecting pilasters to the oculus
    const beamLen = R - oculusR;
    const beamMidR = oculusR + beamLen / 2;
    for (let i = 0; i < sides; i++) {
      const cornerA = ((i + 0.5) / sides) * Math.PI * 2;
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.22, beamLen),
        this.pilasterMat
      );
      beam.position.set(
        Math.sin(cornerA) * beamMidR,
        H - 0.11,
        -Math.cos(cornerA) * beamMidR
      );
      beam.rotation.y = -cornerA;
      group.add(beam);
    }

    // Oculus cylindrical drum
    const oculusDrum = new THREE.Mesh(
      new THREE.CylinderGeometry(oculusR, oculusR, 0.9, 40, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xe6ded0,
        roughness: 0.85,
        side: THREE.BackSide
      })
    );
    oculusDrum.position.y = H + 0.45;
    group.add(oculusDrum);

    // Soft daylight sky plane at top of oculus
    const skylight = new THREE.Mesh(
      new THREE.CircleGeometry(oculusR + 0.1, 40),
      new THREE.MeshBasicMaterial({ color: 0xf7efe0 })
    );
    skylight.rotation.x = Math.PI / 2;
    skylight.position.y = H + 0.88;
    group.add(skylight);

    // Brass oculus trim ring + radial mullions
    const oculusTrim = new THREE.Mesh(
      new THREE.TorusGeometry(oculusR, 0.07, 12, 48),
      this.brassMat
    );
    oculusTrim.rotation.x = Math.PI / 2;
    oculusTrim.position.y = H;
    group.add(oculusTrim);

    for (let s = 0; s < 4; s++) {
      const mullion = new THREE.Mesh(
        new THREE.BoxGeometry(oculusR * 2, 0.05, 0.05),
        this.darkStoneMat
      );
      mullion.position.y = H + 0.72;
      mullion.rotation.y = (s / 4) * Math.PI;
      group.add(mullion);
    }

    // 4. Suspended circular gallery lighting track
    const trackR = this.standRadius - 0.55;
    const trackY = 5.45;
    const trackRing = new THREE.Mesh(
      new THREE.TorusGeometry(trackR, 0.032, 10, 64),
      this.darkStoneMat
    );
    trackRing.rotation.x = Math.PI / 2;
    trackRing.position.y = trackY;
    group.add(trackRing);

    const hangerCount = Math.max(6, standAngles.length);
    for (let h = 0; h < hangerCount; h++) {
      const ha = (h / hangerCount) * Math.PI * 2;
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, H - trackY, 8),
        this.darkStoneMat
      );
      rod.position.set(
        Math.sin(ha) * trackR,
        trackY + (H - trackY) / 2,
        -Math.cos(ha) * trackR
      );
      group.add(rod);
    }

    this.roomGroup.add(group);
  }

  _createMuseumStand(project, idx, total, angle) {
    const THREE = this.THREE;
    const root = new THREE.Group();
    root.userData.projectIndex = idx;

    const sx = Math.sin(angle) * this.standRadius;
    const sz = -Math.cos(angle) * this.standRadius;
    root.position.set(sx, 0, sz);
    root.rotation.y = -angle;

    // 1. Floor contact shadow
    const floorShadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.72
    });
    const floorShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 2.35),
      floorShadowMat
    );
    floorShadow.rotation.x = -Math.PI / 2;
    floorShadow.position.y = 0.005;
    floorShadow.raycast = () => {};
    root.add(floorShadow);

    // 2. Recessed plinth kickplate
    const kickplate = new THREE.Mesh(
      new THREE.BoxGeometry(1.36, 0.14, 1.36),
      this.darkStoneMat
    );
    kickplate.position.y = 0.07;
    kickplate.userData.projectIndex = idx;
    root.add(kickplate);

    // 3. Main walnut pedestal body
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(1.46, 1.08, 1.46),
      this.walnutMat
    );
    pedestal.position.y = 0.68;
    pedestal.userData.projectIndex = idx;
    root.add(pedestal);

    // 4. Brushed brass trim collar
    const collar = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.042, 1.5),
      this.brassMat
    );
    collar.position.y = 1.24;
    collar.userData.projectIndex = idx;
    root.add(collar);

    // 5. Top deck & velvet exhibition pad
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.045, 1.42),
      this.darkStoneMat
    );
    deck.position.y = 1.285;
    deck.userData.projectIndex = idx;
    root.add(deck);

    const velvetPad = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.036, 1.12),
      this.velvetMat
    );
    velvetPad.position.y = 1.325;
    velvetPad.userData.projectIndex = idx;
    root.add(velvetPad);

    // Soft shadow on velvet pad under specimen
    const padShadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.65
    });
    const padShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 0.82),
      padShadowMat
    );
    padShadow.rotation.x = -Math.PI / 2;
    padShadow.position.y = 1.346;
    padShadow.raycast = () => {};
    root.add(padShadow);

    // Tiered specimen turntable base
    const turntableRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.32, 0.045, 36),
      this.brassMat
    );
    turntableRing.position.y = 1.365;
    turntableRing.raycast = () => {};
    root.add(turntableRing);

    const turntableDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.27, 0.28, 0.055, 36),
      this.darkStoneMat
    );
    turntableDisc.position.y = 1.38;
    turntableDisc.raycast = () => {};
    root.add(turntableDisc);

    // 6. Glass Vitrine Display Case (y = 1.31 to 2.67)
    const vitrineW = 1.26;
    const vitrineH = 1.36;
    const vitrineBottom = 1.31;
    const vitrineCenterY = vitrineBottom + vitrineH / 2;

    // Corner brass posts
    const halfV = vitrineW / 2;
    const postGeo = new THREE.BoxGeometry(0.026, vitrineH, 0.026);
    const corners = [
      [-halfV, -halfV],
      [halfV, -halfV],
      [-halfV, halfV],
      [halfV, halfV]
    ];
    for (const [cx, cz] of corners) {
      const post = new THREE.Mesh(postGeo, this.brassMat);
      post.position.set(cx, vitrineCenterY, cz);
      post.raycast = () => {};
      root.add(post);
    }

    // Vitrine brass cap frame & subtle warm interior light strip
    const capFrame = new THREE.Mesh(
      new THREE.BoxGeometry(vitrineW + 0.04, 0.045, vitrineW + 0.04),
      this.brassMat
    );
    capFrame.position.y = vitrineBottom + vitrineH + 0.015;
    capFrame.userData.projectIndex = idx;
    root.add(capFrame);

    const interiorLightStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(vitrineW - 0.14, vitrineW - 0.14),
      new THREE.MeshBasicMaterial({ color: 0xfff1d6 })
    );
    interiorLightStrip.rotation.x = Math.PI / 2;
    interiorLightStrip.position.y = vitrineBottom + vitrineH - 0.012;
    interiorLightStrip.raycast = () => {};
    root.add(interiorLightStrip);

    // Transparent museum glass panes (rendered after the STL inside)
    const glassBox = new THREE.Mesh(
      new THREE.BoxGeometry(vitrineW - 0.01, vitrineH - 0.01, vitrineW - 0.01),
      this.glassMat
    );
    glassBox.position.y = vitrineCenterY;
    glassBox.renderOrder = 2;
    glassBox.userData.projectIndex = idx;
    root.add(glassBox);

    // 7. 3D STL Project Model inside the Vitrine
    const artifact = createSTLHolder(THREE, project, idx);
    root.add(artifact.group);

    // 8. Museum Project Description Plaque with raised 4-piece brass bezel frame
    const plaqueSupport = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 0.42, 0.07),
      this.walnutMat
    );
    plaqueSupport.position.set(0, 0.56, 0.765);
    plaqueSupport.userData.projectIndex = idx;
    root.add(plaqueSupport);

    const plaqueGroup = new THREE.Group();
    plaqueGroup.position.set(0, 0.72, 0.825);
    plaqueGroup.rotation.x = -0.14; // Tilted slightly upward toward the viewer without clipping pedestal

    const plaqueW = 1.28;
    const plaqueH = 0.85;
    const borderT = 0.036;
    const bezelDepth = 0.032;

    // Walnut backing mount
    const plaqueBacking = new THREE.Mesh(
      new THREE.BoxGeometry(plaqueW + borderT * 2 + 0.02, plaqueH + borderT * 2 + 0.02, 0.03),
      this.walnutMat
    );
    plaqueBacking.userData.projectIndex = idx;
    plaqueGroup.add(plaqueBacking);

    const plaqueTex = createStandPlaqueTexture(THREE, project, idx, total);
    const plaqueFace = new THREE.Mesh(
      new THREE.PlaneGeometry(plaqueW, plaqueH),
      new THREE.MeshStandardMaterial({
        map: plaqueTex,
        roughness: 0.62,
        metalness: 0.04
      })
    );
    plaqueFace.position.z = 0.018;
    plaqueFace.userData.projectIndex = idx;
    plaqueGroup.add(plaqueFace);

    // 4-piece raised brushed-brass bezel bars framing the plaque
    const bezelTop = new THREE.Mesh(
      new THREE.BoxGeometry(plaqueW + borderT * 2, borderT, bezelDepth),
      this.brassMat
    );
    bezelTop.position.set(0, plaqueH / 2 + borderT / 2, 0.022);
    bezelTop.userData.projectIndex = idx;

    const bezelBottom = new THREE.Mesh(
      new THREE.BoxGeometry(plaqueW + borderT * 2, borderT, bezelDepth),
      this.brassMat
    );
    bezelBottom.position.set(0, -plaqueH / 2 - borderT / 2, 0.022);
    bezelBottom.userData.projectIndex = idx;

    const bezelLeft = new THREE.Mesh(
      new THREE.BoxGeometry(borderT, plaqueH, bezelDepth),
      this.brassMat
    );
    bezelLeft.position.set(-plaqueW / 2 - borderT / 2, 0, 0.022);
    bezelLeft.userData.projectIndex = idx;

    const bezelRight = new THREE.Mesh(
      new THREE.BoxGeometry(borderT, plaqueH, bezelDepth),
      this.brassMat
    );
    bezelRight.position.set(plaqueW / 2 + borderT / 2, 0, 0.022);
    bezelRight.userData.projectIndex = idx;

    plaqueGroup.add(bezelTop, bezelBottom, bezelLeft, bezelRight);

    root.add(plaqueGroup);

    // 9. Ceiling track spotlight can directly above this stand
    const spotCan = new THREE.Group();
    const canR = this.standRadius - 0.55;
    spotCan.position.set(0, 5.4, this.standRadius - canR);
    const canBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.08, 0.22, 14),
      this.darkStoneMat
    );
    canBody.rotation.x = 0.42;
    spotCan.add(canBody);

    const canLens = new THREE.Mesh(
      new THREE.CircleGeometry(0.068, 14),
      new THREE.MeshBasicMaterial({ color: 0xffefd0 })
    );
    canLens.rotation.x = Math.PI / 2;
    canLens.position.set(0, -0.112, 0);
    canBody.add(canLens);

    spotCan.raycast = () => {};
    root.add(spotCan);

    return {
      project,
      angle,
      root,
      artifact,
      hoverAmount: 0
    };
  }

  _computeStandAngle(index, total) {
    if (total <= 1) return 0;
    if (total === 2) {
      return index === 0 ? -Math.PI / 6 : Math.PI / 6;
    }
    return (index / total) * Math.PI * 2;
  }

  setProjects(projects, initialIndex = 0) {
    for (const stand of this.stands) {
      stand.artifact.markDisposed();
      this.standsGroup.remove(stand.root);
      disposeObjectTree(stand.root, this._sharedMaterials, this._sharedTextures);
    }
    this.stands = [];
    this.projects = projects;

    this.standRadius = Math.max(5.5, projects.length * 0.85);
    this.roomRadius = Math.max(10.5, this.standRadius + 4.8);

    const standAngles = projects.map((_, idx) => this._computeStandAngle(idx, projects.length));
    this._buildMuseumRoom(standAngles);

    projects.forEach((project, idx) => {
      const angle = standAngles[idx];
      const stand = this._createMuseumStand(project, idx, projects.length, angle);
      this.standsGroup.add(stand.root);
      this.stands.push(stand);
    });

    const clamped = Math.max(0, Math.min(initialIndex, Math.max(0, projects.length - 1)));
    this.targetIndex = clamped;
    const startAngle = this.stands[clamped]?.angle ?? 0;
    this.targetAngle = startAngle;
    this.camAngle = startAngle;
    this.camAngularVel = 0;
  }

  setActiveIndex(index) {
    if (!this.projects.length) return;
    const clamped = Math.max(0, Math.min(index, this.projects.length - 1));
    this.targetIndex = clamped;

    const desiredAngle = this.stands[clamped]?.angle ?? 0;
    if (this.projects.length <= 2) {
      this.targetAngle = desiredAngle;
    } else {
      // Shortest angular turn around the museum room (handles 360° wrap cleanly)
      let diff = desiredAngle - this.targetAngle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.targetAngle += diff;
    }

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
        if (totalDx < 0) {
          this.onSelectIndex(this.targetIndex + 1);
        } else {
          this.onSelectIndex(this.targetIndex - 1);
        }
        return;
      }

      if (moved < 9) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const hitIdx = this._pickStandIndex();
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

  _pickStandIndex() {
    if (!this.stands.length) return -1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = this.stands.map((s) => s.root);
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

    // Critically-damped angular spring rotating the camera around the museum room
    const stiffness = 175;
    const damping = 25;
    const force = (this.targetAngle - this.camAngle) * stiffness;
    this.camAngularVel += (force - this.camAngularVel * damping) * dt;
    this.camAngle += this.camAngularVel * dt;

    this.smoothPointer.lerp(this.pointer, 1 - Math.exp(-8 * dt));

    const targetInspect = this.isInspecting ? 1 : 0;
    this.inspectProgress += (targetInspect - this.inspectProgress) * (1 - Math.exp(-9 * dt));

    // Hover detection
    let nextHover = -1;
    if (!this._drag.active) {
      nextHover = this._pickStandIndex();
    }
    if (nextHover !== this.hoveredIndex) {
      this.hoveredIndex = nextHover;
      this.renderer.domElement.style.cursor =
        this.isInspecting ? 'grab' : nextHover !== -1 ? 'pointer' : 'default';
      this.onHoverChange(nextHover);
    } else if (this.isInspecting) {
      this.renderer.domElement.style.cursor = this._drag.active ? 'grabbing' : 'grab';
    }

    // Camera position & lookAt rotating around the center of the gallery room
    const dirX = Math.sin(this.camAngle);
    const dirZ = -Math.cos(this.camAngle);
    const rightX = Math.cos(this.camAngle);
    const rightZ = Math.sin(this.camAngle);

    const isWide = window.innerWidth > 980;
    const orbitR = 1.3 + this.inspectProgress * 1.8;
    const inspectShiftRight = isWide ? 0.65 * this.inspectProgress : 0;
    const parallaxRight = this.smoothPointer.x * 0.2 * (1 - this.inspectProgress * 0.78);
    const parallaxUp = this.smoothPointer.y * 0.1 * (1 - this.inspectProgress * 0.78);

    const camY = 1.82 + this.inspectProgress * 0.06 + parallaxUp;
    this.camera.position.set(
      dirX * orbitR + rightX * (inspectShiftRight + parallaxRight),
      camY,
      dirZ * orbitR + rightZ * (inspectShiftRight + parallaxRight)
    );

    const lookDist = this.standRadius;
    const lookY = 1.48 + this.inspectProgress * 0.44;
    this.camera.lookAt(
      dirX * lookDist + rightX * (inspectShiftRight * 0.8),
      lookY,
      dirZ * lookDist + rightZ * (inspectShiftRight * 0.8)
    );

    // Track spotlight & interior vitrine light follow the camera's active stand
    this.standSpot.position.set(
      dirX * (this.standRadius - 0.65),
      5.35,
      dirZ * (this.standRadius - 0.65)
    );
    this.standSpotTarget.position.set(
      dirX * this.standRadius,
      1.6,
      dirZ * this.standRadius
    );
    this.vitrineLight.position.set(
      dirX * this.standRadius,
      2.52,
      dirZ * this.standRadius
    );

    // Update 3D artifacts inside each stationary museum stand
    for (let i = 0; i < this.stands.length; i++) {
      const stand = this.stands[i];
      const isFocused = i === this.targetIndex;
      const isHovered = i === this.hoveredIndex;

      const spinSpeed = (isHovered ? 1.45 : isFocused ? 0.9 : 0.45) * motionFactor;
      stand.artifact.update(elapsed, dt, spinSpeed, isFocused ? this.inspectProgress : 0, motionFactor);

      if (isFocused) {
        const orbitEase = 1 - Math.exp(-10 * dt);
        stand.artifact.orbitGroup.rotation.y +=
          (this.inspectYaw - stand.artifact.orbitGroup.rotation.y) * orbitEase;
        stand.artifact.orbitGroup.rotation.x +=
          (this.inspectPitch - stand.artifact.orbitGroup.rotation.x) * orbitEase;
        stand.artifact.orbitGroup.scale.setScalar(1 + this.inspectProgress * 0.16);
      } else {
        const resetEase = 1 - Math.exp(-8 * dt);
        stand.artifact.orbitGroup.rotation.y +=
          (0 - stand.artifact.orbitGroup.rotation.y) * resetEase;
        stand.artifact.orbitGroup.rotation.x +=
          (0 - stand.artifact.orbitGroup.rotation.x) * resetEase;
        stand.artifact.orbitGroup.scale.setScalar(1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);

    for (const stand of this.stands) {
      stand.artifact.markDisposed();
      disposeObjectTree(stand.root, this._sharedMaterials, this._sharedTextures);
    }
    if (this.roomDynamicGroup) {
      disposeObjectTree(this.roomDynamicGroup, this._sharedMaterials, this._sharedTextures);
    }
    for (const tex of this._sharedTextures) {
      tex?.dispose();
    }
    for (const mat of this._sharedMaterials) {
      mat?.dispose();
    }
    this.renderer.dispose();
  }
}
