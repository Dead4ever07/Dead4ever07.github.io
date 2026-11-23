import { PROJECTS } from './projects.js';
import { createProjectCardCanvas } from './textures.js';

window.__SHOWCASE_BOOTED__ = true;

const state = {
  filter: 'all',
  filtered: [...PROJECTS],
  activeIndex: 0,
  isInspecting: false,
  isGridOpen: false
};

const els = {
  canvasContainer: document.getElementById('canvas-container'),
  webglFallback: document.getElementById('webgl-fallback'),
  fallbackOpenGrid: document.getElementById('fallback-open-grid'),
  hud: document.getElementById('hud'),
  hudIndex: document.getElementById('hud-index'),
  hudCategory: document.getElementById('hud-category'),
  hudYear: document.getElementById('hud-year'),
  hudTitle: document.getElementById('hud-title'),
  hudRepoLink: document.getElementById('hud-repo-link'),
  inspectBtn: document.getElementById('inspect-btn'),
  prevBtn: document.getElementById('prev-btn'),
  nextBtn: document.getElementById('next-btn'),
  dockDots: document.getElementById('dock-dots'),
  filterPillsWrap: document.getElementById('filter-pills'),
  brandReset: document.getElementById('brand-reset'),

  inspector: document.getElementById('inspector'),
  inspectorIndex: document.getElementById('inspector-index'),
  inspectorCategory: document.getElementById('inspector-category'),
  inspectorYear: document.getElementById('inspector-year'),
  inspectorTitle: document.getElementById('inspector-title'),
  inspectorTagline: document.getElementById('inspector-tagline'),
  inspectorSummary: document.getElementById('inspector-summary'),
  inspectorHighlights: document.getElementById('inspector-highlights'),
  inspectorStack: document.getElementById('inspector-stack'),
  inspectorRepoLink: document.getElementById('inspector-repo-link'),
  closeInspectorBtn: document.getElementById('close-inspector-btn'),

  toggleGridBtn: document.getElementById('toggle-grid-btn'),
  gridOverlay: document.getElementById('grid-overlay'),
  gridCards: document.getElementById('grid-cards'),
  closeGridBtn: document.getElementById('close-grid-btn')
};

/**
 * Interactive 2.5D CSS Perspective stage used automatically if WebGL or Three.js
 * cannot be loaded (e.g. offline, blocked CDN, or disabled hardware acceleration).
 */
class FallbackStage {
  constructor(container, { onSelectIndex, onInspectIndex }) {
    this.container = container;
    this.onSelectIndex = onSelectIndex;
    this.onInspectIndex = onInspectIndex;
    this.cards = [];
    this.activeIndex = 0;

    this.stage = document.createElement('div');
    this.stage.className = 'fallback-stage';
    this.container.appendChild(this.stage);
  }

  setProjects(projects, initialIndex = 0) {
    this.stage.replaceChildren();
    this.cards = projects.map((project, idx) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'fallback-card-3d';
      card.setAttribute('aria-label', `${project.title} (${project.category})`);

      const canvas = createProjectCardCanvas(project, idx, projects.length);
      card.appendChild(canvas);

      card.addEventListener('click', () => {
        if (idx === this.activeIndex) {
          this.onInspectIndex(idx);
        } else {
          this.onSelectIndex(idx);
        }
      });

      this.stage.appendChild(card);
      return card;
    });

    this.setActiveIndex(initialIndex);
  }

  setActiveIndex(index) {
    this.activeIndex = index;
    this.cards.forEach((card, idx) => {
      const offset = idx - index;
      const abs = Math.abs(offset);
      const tx = offset * 300;
      const tz = -abs * 140;
      const ry = -offset * 16;
      const scale = Math.max(0.72, 1 - abs * 0.14);
      const opacity = Math.max(0.2, 1 - abs * 0.28);

      card.style.transform = `translate3d(${tx}px, 0, ${tz}px) rotateY(${ry}deg) scale(${scale})`;
      card.style.opacity = String(opacity);
      card.style.zIndex = String(50 - abs);
      card.classList.toggle('is-focused', offset === 0);
    });
  }

  setInspecting(inspecting) {
    this.stage.classList.toggle('is-inspecting', inspecting);
  }

  dispose() {
    this.stage.remove();
  }
}

function renderStackChips(container, stack) {
  container.replaceChildren(
    ...(stack || []).map((tech) => {
      const span = document.createElement('span');
      span.className = 'stack-chip';
      span.textContent = tech;
      return span;
    })
  );
}

function renderFilterPills() {
  const categories = ['all', ...new Set(PROJECTS.map((p) => p.category).filter(Boolean))];
  els.filterPillsWrap.replaceChildren(
    ...categories.map((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pill${state.filter === cat ? ' is-active' : ''}`;
      btn.dataset.filter = cat;
      btn.textContent = cat === 'all' ? 'All' : cat;
      btn.addEventListener('click', () => {
        setInspecting(false);
        applyFilter(cat);
      });
      return btn;
    })
  );
}

function renderDockDots() {
  els.dockDots.replaceChildren(
    ...state.filtered.map((project, idx) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `dock-dot${idx === state.activeIndex ? ' is-active' : ''}`;
      dot.setAttribute('aria-label', `Rotate to ${project.title}`);
      dot.setAttribute('aria-selected', String(idx === state.activeIndex));
      dot.addEventListener('click', () => selectProject(idx));
      return dot;
    })
  );
}

function updateActiveUI() {
  const project = state.filtered[state.activeIndex];
  if (!project) return;

  const idxText = `EXHIBIT ${String(state.activeIndex + 1).padStart(2, '0')} / ${String(
    state.filtered.length
  ).padStart(2, '0')}`;

  els.hudIndex.textContent = idxText;
  els.hudCategory.textContent = project.category;
  els.hudYear.textContent = project.year;
  els.hudTitle.textContent = project.title;
  els.hudRepoLink.href = project.repoUrl;

  els.inspectorIndex.textContent = idxText;
  els.inspectorCategory.textContent = project.category;
  els.inspectorYear.textContent = project.year;
  els.inspectorTitle.textContent = project.title;
  els.inspectorTagline.textContent = project.tagline || '';
  els.inspectorSummary.textContent = project.summary || '';
  renderStackChips(els.inspectorStack, project.stack);
  els.inspectorRepoLink.href = project.repoUrl;

  els.inspectorHighlights.replaceChildren(
    ...(project.highlights || []).map((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    })
  );

  const dots = els.dockDots.children;
  for (let i = 0; i < dots.length; i++) {
    const active = i === state.activeIndex;
    dots[i].classList.toggle('is-active', active);
    dots[i].setAttribute('aria-selected', String(active));
  }
}

function renderGrid() {
  els.gridCards.replaceChildren(
    ...PROJECTS.map((project, globalIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'grid-item';

      const top = document.createElement('div');
      top.className = 'grid-item-top';

      const idxSpan = document.createElement('span');
      idxSpan.className = 'mono-tag';
      idxSpan.textContent = `EXH-${String(globalIdx + 1).padStart(2, '0')} // ${project.year}`;

      const catSpan = document.createElement('span');
      catSpan.className = 'category-chip';
      catSpan.textContent = project.category;

      top.append(idxSpan, catSpan);

      const h3 = document.createElement('h3');
      h3.textContent = project.title;

      const p = document.createElement('p');
      p.textContent = project.tagline || project.summary || '';

      const stackWrap = document.createElement('div');
      stackWrap.className = 'stack-list';
      renderStackChips(stackWrap, project.stack);

      btn.append(top, h3, p, stackWrap);

      btn.addEventListener('click', () => {
        setGridOpen(false);
        applyFilter('all');
        selectProject(globalIdx);
      });

      return btn;
    })
  );
}

let activeStage = null;

function selectProject(index) {
  if (!state.filtered.length) return;
  const wrapped = (index + state.filtered.length) % state.filtered.length;
  state.activeIndex = wrapped;
  updateActiveUI();
  activeStage?.setActiveIndex(wrapped);
}

function setInspecting(open) {
  state.isInspecting = open;
  els.inspector.classList.toggle('is-open', open);
  els.inspector.setAttribute('aria-hidden', String(!open));
  els.hud.classList.toggle('is-dimmed', open);
  activeStage?.setInspecting(open);
}

function setGridOpen(open) {
  state.isGridOpen = open;
  els.gridOverlay.classList.toggle('is-open', open);
  els.gridOverlay.setAttribute('aria-hidden', String(!open));
  els.toggleGridBtn.setAttribute('aria-expanded', String(open));
}

function applyFilter(category) {
  state.filter = category;
  state.filtered =
    category === 'all'
      ? [...PROJECTS]
      : PROJECTS.filter((p) => p.category === category);

  state.activeIndex = 0;

  for (const pill of els.filterPillsWrap.querySelectorAll('.pill')) {
    pill.classList.toggle('is-active', pill.dataset.filter === category);
  }

  renderDockDots();
  updateActiveUI();
  activeStage?.setProjects(state.filtered, 0);
}

function isWebGLSupported() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

async function mountThreeStage() {
  if (!isWebGLSupported()) return false;

  const { loadThree, ShowcaseScene } = await import('./scene.js');
  const THREE = await loadThree();

  const threeStage = new ShowcaseScene(THREE, els.canvasContainer, {
    onSelectIndex: (idx) => selectProject(idx),
    onInspectIndex: (idx) => {
      selectProject(idx);
      setInspecting(true);
    }
  });

  if (activeStage) {
    activeStage.dispose();
  }
  activeStage = threeStage;
  activeStage.setProjects(state.filtered, state.activeIndex);
  activeStage.setInspecting(state.isInspecting);
  return true;
}

function init() {
  renderFilterPills();
  renderGrid();
  renderDockDots();
  updateActiveUI();

  // Mount interactive 2.5D fallback stage immediately so exhibits are always visible
  activeStage = new FallbackStage(els.canvasContainer, {
    onSelectIndex: (idx) => selectProject(idx),
    onInspectIndex: (idx) => {
      selectProject(idx);
      setInspecting(true);
    }
  });
  activeStage.setProjects(state.filtered, state.activeIndex);

  // Upgrade seamlessly to WebGL Three.js 3D Museum Room
  mountThreeStage().catch((err) => {
    console.warn('Three.js WebGL stage unavailable, using 2.5D stage:', err);
  });

  els.prevBtn.addEventListener('click', () => selectProject(state.activeIndex - 1));
  els.nextBtn.addEventListener('click', () => selectProject(state.activeIndex + 1));
  els.inspectBtn.addEventListener('click', () => setInspecting(true));
  els.closeInspectorBtn.addEventListener('click', () => setInspecting(false));

  els.toggleGridBtn.addEventListener('click', () => setGridOpen(!state.isGridOpen));
  els.closeGridBtn.addEventListener('click', () => setGridOpen(false));
  if (els.fallbackOpenGrid) {
    els.fallbackOpenGrid.addEventListener('click', () => setGridOpen(true));
  }

  els.brandReset.addEventListener('click', (e) => {
    e.preventDefault();
    setInspecting(false);
    setGridOpen(false);
    applyFilter('all');
  });

  let wheelLockUntil = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      if (state.isGridOpen || state.isInspecting) return;
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(delta) < 18) return;

      const now = performance.now();
      if (now < wheelLockUntil) return;
      wheelLockUntil = now + 220;

      if (delta > 0) {
        selectProject(state.activeIndex + 1);
      } else {
        selectProject(state.activeIndex - 1);
      }
    },
    { passive: true }
  );

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (state.isGridOpen) setGridOpen(false);
      else if (state.isInspecting) setInspecting(false);
      return;
    }

    if (e.key.toLowerCase() === 'g') {
      e.preventDefault();
      setGridOpen(!state.isGridOpen);
      return;
    }

    if (state.isGridOpen) return;

    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') {
      e.preventDefault();
      selectProject(state.activeIndex + 1);
    } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'h') {
      e.preventDefault();
      selectProject(state.activeIndex - 1);
    } else if (e.key === 'Enter' && !state.isInspecting) {
      const tag = document.activeElement?.tagName;
      if (tag !== 'A' && tag !== 'BUTTON') {
        setInspecting(true);
      }
    } else if (/^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < state.filtered.length) {
        selectProject(idx);
      }
    }
  });
}

init();
