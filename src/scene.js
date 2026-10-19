import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createScene(container) {
  const isHall = container.dataset.presentation === 'hall';
  const scene = new THREE.Scene();
  scene.background = isHall ? null : new THREE.Color('#c4d2cf');

  const camera = new THREE.PerspectiveCamera(isHall ? 32 : 40, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: isHall });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = isHall ? 1.25 : 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', '油纸伞三维预览，可拖动旋转、滚轮缩放');
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  // 环境只参与材质受光；首屏背景由页面的暗化图片承担。
  let environmentTarget;
  if (isHall) {
    const environment = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    environmentTarget = generator.fromScene(environment, 0.08);
    environment.dispose();
    generator.dispose();
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.3;
  controls.maxDistance = 8;

  scene.add(new THREE.HemisphereLight(
    isHall ? '#fff1ca' : '#dce8e6',
    isHall ? '#767044' : '#30302a',
    isHall ? 0.12 : 0.2,
  ));
  const keyLight = new THREE.DirectionalLight('#fff0cf', 6);
  keyLight.target.position.set(0, 1.25, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(keyLight.shadow.camera, {
    left: -1.8, right: 1.8, top: 1.8, bottom: -1.8, near: 0.1, far: 12,
  });
  keyLight.shadow.camera.updateProjectionMatrix();
  keyLight.shadow.bias = -0.00005;
  keyLight.shadow.normalBias = isHall ? 0.001 : 0.003;
  scene.add(keyLight, keyLight.target);
  const fillLight = new THREE.DirectionalLight(isHall ? '#ffe3b0' : '#bed7e2', isHall ? 0.18 : 0.08);
  fillLight.position.set(2.6, 0.4, 3.4);
  scene.add(fillLight);

  // 首屏以低位侧逆光穿过撑骨，投影落在伞面内侧；调参台保持原来的仰角。
  function setLighting(angle = 45, intensity = 6, temperature = isHall ? 4500 : null) {
    if (!Number.isFinite(angle) || angle < 15 || angle > 75
      || !Number.isFinite(intensity) || intensity < 0 || intensity > 12) {
      throw new RangeError('主光角度须在 15° 到 75° 之间，强度须在 0 到 12 之间');
    }
    if (temperature !== null) {
      if (!Number.isFinite(temperature) || temperature < 2700 || temperature > 7500) {
        throw new RangeError('主光色温须在 2700 K 到 7500 K 之间');
      }
      // 将色温近似换算为屏幕颜色，再交给 Three.js 转入线性颜色空间。
      const t = temperature / 100;
      const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
      const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661
        : 288.1221695283 * (t - 60) ** -0.0755148492;
      const blue = t >= 66 ? 255 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
      keyLight.color.setRGB(
        THREE.MathUtils.clamp(red, 0, 255) / 255,
        THREE.MathUtils.clamp(green, 0, 255) / 255,
        THREE.MathUtils.clamp(blue, 0, 255) / 255,
        THREE.SRGBColorSpace,
      );
    }
    const elevation = THREE.MathUtils.degToRad(isHall ? -angle : angle);
    const horizontal = 6 * Math.cos(elevation);
    const azimuth = Math.atan2(2.6, 3.4) + Math.PI;
    keyLight.position.set(
      horizontal * Math.sin(azimuth),
      1.25 + 6 * Math.sin(elevation),
      horizontal * Math.cos(azimuth),
    );
    keyLight.intensity = intensity;
  }
  setLighting();

  let umbrella = null;

  function disposeUmbrella(object) {
    const geometries = new Set();
    const materials = new Set();
    object.traverse((part) => {
      if (part.geometry) geometries.add(part.geometry);
      if (part.material) {
        const list = Array.isArray(part.material) ? part.material : [part.material];
        list.forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  function setUmbrella(next) {
    if (next === umbrella) return;
    if (umbrella) {
      scene.remove(umbrella);
      disposeUmbrella(umbrella);
    }
    umbrella = next;
    umbrella.traverse((part) => {
      if (!part.isMesh) return;
      part.castShadow = part.name !== 'canopy';
      part.receiveShadow = part.name === 'canopy';
      if (isHall && part.name === 'canopy') {
        part.material.envMap = environmentTarget.texture;
        part.material.envMapIntensity = 0.35;
        part.material.needsUpdate = true;
      }
    });
    scene.add(umbrella);
  }

  function resetView() {
    controls.target.set(0, isHall ? 0.95 : 0.9, 0);
    if (isHall) camera.position.set(2.6, -1.0, 3.4);
    else camera.position.set(2.6, -1.3, 3.4);
    controls.update();
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resetView();
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  function dispose() {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    controls.dispose();
    if (umbrella) disposeUmbrella(umbrella);
    keyLight.shadow.dispose();
    environmentTarget?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setUmbrella, setLighting, resetView, dispose };
}
