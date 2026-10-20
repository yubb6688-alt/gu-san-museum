const list = document.querySelector('#umbrella-list');
const stage = document.querySelector('#stage');
const viewport = document.querySelector('#viewport');
const controls = document.querySelector('.stage-controls');
const settingsToggle = document.querySelector('#settings-toggle');
const openAmount = document.querySelector('#open-amount');
const openValue = document.querySelector('#open-value');
const pattern = document.querySelector('#pattern');
const patternList = document.querySelector('#pattern-list');
const plainCanopy = document.querySelector('#plain-canopy');
const status = document.querySelector('#stage-status');
const parameterOverlay = document.querySelector('#parameter-overlay');
const parameterOpen = document.querySelector('#parameter-open');
const parameterClose = document.querySelector('#parameter-close');
const parameterReset = document.querySelector('#parameter-reset');
const parameterContent = document.querySelector('#parameter-content');

let selectedUmbrella;
let parameterValues = { geometry: {}, material: {} };
const lightingValues = { angle: 45, intensity: 7.4, temperature: 4800 };
let umbrella;
let scene;
let createUmbrella;
let THREE;
let RoomEnvironment;
let animationId;
let dragging = false;

function changePattern(value) {
  pattern.value = value;
  plainCanopy.checked = false;
  updatePatternSelection();
  rebuildUmbrella();
}

function updatePatternSelection() {
  for (const button of patternList.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(!plainCanopy.checked && button.dataset.texture === pattern.value));
    button.disabled = !scene;
  }
}

function renderPatternList() {
  patternList.replaceChildren();
  for (const option of pattern.options) {
    if (!option.value) continue;
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const label = document.createElement('span');
    label.textContent = option.textContent;
    button.append(label);
    if (option.value) {
      const preview = document.createElement('canvas');
      preview.width = 228;
      preview.height = 156;
      preview.setAttribute('aria-hidden', 'true');
      preview.className = 'pattern-preview';
      button.append(preview);
    }
    button.dataset.texture = option.value;
    button.addEventListener('click', () => {
      if (pattern.value === option.value && !plainCanopy.checked
        && umbrella?.userData.canopyTexture?.userData.state !== 'error') return;
      changePattern(option.value);
    });
    item.append(button);
    patternList.append(item);
  }
  updatePatternSelection();
}

// 共用伞生成器，一台临时渲染器依次绘制八张完整伞预览，完成后释放。
async function renderUmbrellaPreviews() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(228, 156);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const previewScene = new THREE.Scene();
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = generator.fromScene(environment, 0.08);
  environment.dispose();
  generator.dispose();
  previewScene.environment = environmentTarget.texture;
  previewScene.add(new THREE.HemisphereLight('#fff1ca', '#767044', 1));
  const light = new THREE.DirectionalLight('#fff0df', 3);
  light.position.set(2, 4, 3);
  previewScene.add(light);
  const aspect = 228 / 156;
  const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.01, 100);

  try {
    for (const button of patternList.querySelectorAll('button')) {
      const object = createUmbrella({
        ...selectedUmbrella.geometry,
        ...selectedUmbrella.material,
        openAmount: 1,
        canopyTexture: button.dataset.texture,
      });
      const geometries = new Set();
      const materials = new Set();
      object.traverse((part) => {
        if (part.geometry) geometries.add(part.geometry);
        if (part.material) {
          materials.add(part.material);
        }
      });
      try {
        // 慢网络下继续等待；单张加载失败不终止后续预览。
        await object.userData.texturesReady;
        if (object.userData.canopyTexture?.userData.state === 'error') continue;
        const bounds = new THREE.Box3().setFromObject(object);
        const center = bounds.getCenter(new THREE.Vector3());
        camera.position.copy(center).add(new THREE.Vector3(2.6, 2.2, 4));
        camera.lookAt(center);
        camera.updateMatrixWorld();
        // 按相机里实际看到的轮廓取景，让完整伞占满缩略图而不裁掉手柄。
        const frame = new THREE.Box3();
        const point = new THREE.Vector3();
        object.traverse((part) => {
          const vertices = part.geometry?.attributes.position;
          if (!vertices) return;
          for (let i = 0; i < vertices.count; i++) {
            point.fromBufferAttribute(vertices, i).applyMatrix4(part.matrixWorld)
              .applyMatrix4(camera.matrixWorldInverse);
            frame.expandByPoint(point);
          }
        });
        const size = frame.getSize(new THREE.Vector3());
        const focus = frame.getCenter(new THREE.Vector3());
        const halfHeight = Math.max(size.y, size.x / aspect) * 0.55;
        camera.left = focus.x - halfHeight * aspect;
        camera.right = focus.x + halfHeight * aspect;
        camera.top = focus.y + halfHeight;
        camera.bottom = focus.y - halfHeight;
        camera.updateProjectionMatrix();
        previewScene.add(object);
        renderer.render(previewScene, camera);
        const canvas = button.querySelector('.pattern-preview');
        canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
        canvas.dataset.ready = 'true';
      } finally {
        previewScene.remove(object);
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        // 贴图由主展台与预览共用，不在这里释放。
      }
    }
  } finally {
    environmentTarget.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

// 首页灯光采用确认后的参数；调参台保持独立。
function applyLighting() {
  scene?.setLighting(lightingValues.angle, lightingValues.intensity, lightingValues.temperature);
}

const parameterDefinitions = [
  { group: '伞面与骨架', category: 'geometry', key: 'radius', label: '伞面半径', min: 0.65, max: 1.5, step: 0.01 },
  { group: '伞面与骨架', category: 'geometry', key: 'canopyHeight', label: '伞面弧度', min: 0.15, max: 0.8, step: 0.01 },
  { group: '伞面与骨架', category: 'geometry', key: 'canopyRise', label: '伞顶高度', min: 0, max: 0.3, step: 0.005 },
  { group: '伞面与骨架', category: 'geometry', key: 'canopyPleat', label: '伞面折痕凹凸', min: 0, max: 1, step: 0.01, default: 0.35 },
  { group: '伞面与骨架', category: 'geometry', key: 'ribCount', label: '伞骨数量', min: 12, max: 48, step: 1 },
  { group: '伞面与骨架', category: 'geometry', key: 'shaftLength', label: '伞柄长度', min: 0.8, max: 2.5, step: 0.01 },
  { group: '伞面材质', category: 'material', key: 'canopyColor', label: '伞面底色', type: 'color' },
  { group: '伞面材质', category: 'material', key: 'ribColor', label: '伞骨颜色', type: 'color' },
  { group: '伞面材质', category: 'material', key: 'transmission', label: '伞面透光', min: 0, max: 1, step: 0.01 },
  { group: '伞面材质', category: 'material', key: 'roughness', label: '表面柔和度', min: 0, max: 1, step: 0.01 },
  { group: '灯光', category: 'lighting', key: 'angle', label: '主光角度', min: 15, max: 75, step: 1, suffix: '°' },
  { group: '灯光', category: 'lighting', key: 'intensity', label: '主光强度', min: 0, max: 12, step: 0.1 },
  { group: '灯光', category: 'lighting', key: 'temperature', label: '主光色温', min: 2700, max: 7500, step: 100, suffix: ' K' },
];

function renderParameterEditor() {
  parameterContent.replaceChildren();
  let currentGroup;
  let fields;
  for (const definition of parameterDefinitions) {
    if (definition.group !== currentGroup) {
      currentGroup = definition.group;
      const section = document.createElement('section');
      section.className = 'parameter-group';
      const heading = document.createElement('h3');
      heading.textContent = currentGroup;
      fields = document.createElement('div');
      fields.className = 'parameter-fields';
      section.append(heading, fields);
      parameterContent.append(section);
    }
    const field = document.createElement('div');
    field.className = 'parameter-field';
    const input = document.createElement('input');
    input.id = `parameter-${definition.category}-${definition.key}`;
    input.type = definition.type || 'range';
    if (definition.type !== 'color') {
      input.min = definition.min;
      input.max = definition.max;
      input.step = definition.step;
    }
    const label = document.createElement('label');
    label.htmlFor = input.id;
    const labelText = document.createElement('span');
    labelText.textContent = definition.label;
    label.append(labelText);
    let output;
    if (input.type === 'range') {
      output = document.createElement('output');
      output.htmlFor = input.id;
      label.append(output);
    }
    field.append(label, input);
    fields.append(field);

    const readValue = () => definition.category === 'lighting'
      ? lightingValues[definition.key]
      : parameterValues[definition.category][definition.key] ?? definition.default ?? 0;
    const formatValue = (value) => `${Number(value).toFixed(definition.step < 1 ? 2 : 0)}${definition.suffix || ''}`;
    const refresh = () => {
      const value = readValue();
      input.value = value;
      if (output) output.value = formatValue(value);
    };
    refresh();
    input.addEventListener('input', () => {
      const nextValue = input.type === 'color' ? input.value : Number(input.value);
      if (definition.category === 'lighting') {
        lightingValues[definition.key] = nextValue;
        applyLighting();
      } else {
        const previousValue = parameterValues[definition.category][definition.key];
        parameterValues[definition.category][definition.key] = nextValue;
        try {
          rebuildUmbrella();
        } catch (error) {
          parameterValues[definition.category][definition.key] = previousValue;
          refresh();
          status.textContent = '这组参数暂时无法组合，请稍微调回后再试。';
          console.error('参数更新失败', error);
          return;
        }
      }
      if (output) output.value = formatValue(nextValue);
    });
  }
}

const cultureTabs = [...document.querySelectorAll('.culture-tabs [role="tab"]')];

function activateCultureTab(activeTab) {
  for (const tab of cultureTabs) {
    const selected = tab === activeTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
}

cultureTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateCultureTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % cultureTabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + cultureTabs.length) % cultureTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = cultureTabs.length - 1;
    else return;
    event.preventDefault();
    activateCultureTab(cultureTabs[next]);
    cultureTabs[next].focus();
  });
});

function appendCultureText(container, entry, text) {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  container.append(paragraph);
  if (entry.level) {
    const level = document.createElement('p');
    level.className = 'culture-level';
    level.textContent = entry.level;
    container.append(level);
  }
  const source = entry._source;
  if (!source?.title) return;
  const details = document.createElement('details');
  details.className = 'culture-source';
  const summary = document.createElement('summary');
  summary.textContent = source.title;
  details.append(summary);
  if (source.url) {
    const link = document.createElement('a');
    link.href = source.url;
    link.target = source.target === '_self' ? '_self' : '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.publisher || source.title;
    details.append(link);
  }
  if (source.scope) {
    const scope = document.createElement('p');
    scope.textContent = source.scope;
    details.append(scope);
  }
  container.append(details);
}

function renderCulture(umbrella) {
  for (const [panelId, fields] of [
    ['panel-shape', ['shape', 'size', 'materials']],
    ['panel-pattern', ['patternTheme', 'patternMeaning']],
  ]) {
    const panel = document.getElementById(panelId);
    panel.replaceChildren();
    for (const field of fields) {
      const entry = umbrella.culture?.[field];
      if (!entry?.text) continue;
      const article = document.createElement('article');
      article.className = 'culture-entry';
      appendCultureText(article, entry, entry.text);
      panel.append(article);
    }
  }

  const steps = document.createElement('ol');
  steps.className = 'craft-steps';
  for (const step of umbrella.craftSteps ?? []) {
    const item = document.createElement('li');
    item.className = 'craft-step';
    const image = document.createElement('img');
    image.src = step.image;
    image.alt = step.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    const content = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = step.name;
    content.append(heading);
    appendCultureText(content, step, step.desc);
    item.append(image, content);
    steps.append(item);
  }
  document.querySelector('#panel-craft').replaceChildren(steps);
}

function updateOpenValue() {
  openValue.value = `${Math.round(Number(openAmount.value) * 100)}%`;
}

function rebuildUmbrella() {
  const canopySagScale = window.matchMedia('(min-width: 768px)').matches ? 0.02 : 0.12;
  const next = createUmbrella({
    ...selectedUmbrella.geometry,
    ...parameterValues.geometry,
    ...selectedUmbrella.material,
    ...parameterValues.material,
    canopySagScale,
    openAmount: Number(openAmount.value),
    canopyTexture: plainCanopy.checked ? null : pattern.value || null,
  });
  next.rotation.y = umbrella?.rotation.y ?? 0;
  scene.setUmbrella(next);
  umbrella = next;
  const texture = next.userData.canopyTexture;
  status.textContent = texture?.userData.state === 'loading' ? '纹样图片加载中，请稍候…' : '';
  texture?.userData.ready.then((loaded) => {
    if (umbrella !== next) return;
    status.textContent = loaded ? '' : '纹样图片加载失败，请刷新页面，或切换纹样后重试。';
  });
}

function selectUmbrella(umbrella, selectedButton) {
  for (const button of list.querySelectorAll('button')) {
    button.removeAttribute('aria-current');
  }
  selectedButton.setAttribute('aria-current', 'true');
  stage.dataset.umbrellaId = umbrella.id;
  document.title = umbrella.name;
  selectedUmbrella = umbrella;
  parameterValues = {
    geometry: { ...umbrella.geometry },
    material: { ...umbrella.material },
  };
  lightingValues.angle = umbrella.preview?.lightAngle ?? 45;
  lightingValues.intensity = umbrella.preview?.lightIntensity ?? 7.4;
  lightingValues.temperature = umbrella.preview?.lightTemperature ?? 4800;
  renderParameterEditor();
  renderCulture(umbrella);
  openAmount.value = umbrella.geometry.openAmount;
  pattern.replaceChildren();
  for (const item of umbrella.patterns) {
    pattern.add(new Option(item.name, item.texture));
  }
  const texture = umbrella.material.canopyTexture ?? '';
  if (texture && ![...pattern.options].some((option) => option.value === texture)) {
    pattern.add(new Option('当前纹样', texture));
  }
  pattern.value = texture || pattern.options[0]?.value || '';
  plainCanopy.checked = !texture;
  renderPatternList();
  updateOpenValue();
  applyLighting();
  if (scene) {
    rebuildUmbrella();
    renderUmbrellaPreviews().catch(console.error);
  }
}

async function loadCatalog() {
  const response = await fetch(new URL('../data/umbrellas.json', import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const umbrellas = await response.json();

  for (const [index, umbrella] of umbrellas.entries()) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = umbrella.name;
    button.addEventListener('click', () => selectUmbrella(umbrella, button));
    item.append(button);
    list.append(item);

    if (index === 0) selectUmbrella(umbrella, button);
  }

  if (!selectedUmbrella) return;
  status.textContent = '正在加载三维展台…';
  const [umbrellaModule, sceneModule, threeModule, environmentModule] = await Promise.all([
    import('./umbrella.js'), import('./scene.js'), import('three'),
    import('three/addons/environments/RoomEnvironment.js'),
  ]);
  THREE = threeModule;
  RoomEnvironment = environmentModule.RoomEnvironment;
  createUmbrella = umbrellaModule.createUmbrella;
  scene = sceneModule.createScene(viewport);
  applyLighting();
  rebuildUmbrella();
  controls.disabled = false;
  updatePatternSelection();
  renderUmbrellaPreviews().catch(console.error);

  let previousTime;
  function rotate(time) {
    const seconds = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.05);
    previousTime = time;
    if (!dragging && !document.hidden) umbrella.rotation.y += seconds * 0.12;
    animationId = requestAnimationFrame(rotate);
  }
  animationId = requestAnimationFrame(rotate);
}

settingsToggle.addEventListener('click', () => {
  const collapsed = stage.classList.toggle('settings-collapsed');
  settingsToggle.setAttribute('aria-expanded', String(!collapsed));
  settingsToggle.setAttribute('aria-label', collapsed ? '展开设置' : '收起设置');
  settingsToggle.title = collapsed ? '展开设置' : '收起设置';
  settingsToggle.textContent = collapsed ? '⚙' : '⌄';
});

parameterOpen.addEventListener('click', () => {
  parameterOverlay.dataset.open = 'true';
  parameterOpen.setAttribute('aria-expanded', 'true');
  parameterClose.focus();
});
function closeParameterEditor() {
  parameterOverlay.dataset.open = 'false';
  parameterOpen.setAttribute('aria-expanded', 'false');
  parameterOpen.focus();
}
parameterClose.addEventListener('click', closeParameterEditor);
parameterOverlay.addEventListener('click', (event) => {
  if (event.target === parameterOverlay && window.matchMedia('(max-width: 767px), (max-width: 1024px) and (max-height: 600px) and (pointer: coarse)').matches) {
    closeParameterEditor();
  }
});
parameterOverlay.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeParameterEditor();
});
parameterReset.addEventListener('click', () => {
  if (!selectedUmbrella) return;
  parameterValues = {
    geometry: { ...selectedUmbrella.geometry },
    material: { ...selectedUmbrella.material },
  };
  lightingValues.angle = selectedUmbrella.preview?.lightAngle ?? 45;
  lightingValues.intensity = selectedUmbrella.preview?.lightIntensity ?? 7.4;
  lightingValues.temperature = selectedUmbrella.preview?.lightTemperature ?? 4800;
  openAmount.value = selectedUmbrella.geometry.openAmount;
  const texture = selectedUmbrella.material.canopyTexture ?? '';
  pattern.value = texture || pattern.options[0]?.value || '';
  plainCanopy.checked = !texture;
  updateOpenValue();
  renderParameterEditor();
  updatePatternSelection();
  applyLighting();
  rebuildUmbrella();
});

openAmount.addEventListener('input', () => {
  umbrella.userData.setOpenAmount(Number(openAmount.value));
  updateOpenValue();
});
pattern.addEventListener('change', () => {
  changePattern(pattern.value);
});
plainCanopy.addEventListener('change', () => {
  updatePatternSelection();
  rebuildUmbrella();
});
viewport.addEventListener('pointerdown', () => { dragging = true; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointercancel', () => { dragging = false; });
window.addEventListener('blur', () => { dragging = false; });
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  cancelAnimationFrame(animationId);
  scene?.dispose();
});

loadCatalog().catch((error) => {
  status.textContent = '展台加载失败，请检查网络后刷新页面。';
  console.error(error);
});
