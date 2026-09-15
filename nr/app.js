const $ = id => document.getElementById(id);
const canvas = $('drawing');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let drawing = false;
let dirty = false;
let busy = false;
let modelReady = false;
let generation = 0;
let digitModel;

const probabilityRows = Array.from({ length: 10 }, (_, digit) => {
  const row = document.createElement('div');
  const label = document.createElement('span');
  const track = document.createElement('div');
  const bar = document.createElement('div');
  const value = document.createElement('span');
  row.className = 'probability-row';
  label.className = 'probability-digit';
  label.textContent = digit;
  track.className = 'probability-track';
  bar.className = 'probability-bar';
  track.append(bar);
  value.className = 'probability-value';
  value.textContent = '—';
  row.append(label, track, value);
  $('probability-list').append(row);
  return { row, bar, value, digit };
});

class DigitModel {
  constructor(tensors) {
    this.tensors = tensors;
  }

  static async load() {
    if (typeof tf === 'undefined') throw new Error('TensorFlow.js 加载失败');
    await tf.ready();

    const embeddedModel = window.DIGIT_LAB_MODEL;
    const manifest = embeddedModel?.manifest;
    if (manifest?.format !== 'digit-lab-tfjs-weights' || !Array.isArray(manifest.weights) ||
        typeof embeddedModel.weightsBase64 !== 'string') {
      throw new Error('模型清单格式不正确');
    }
    const binary = atob(embeddedModel.weightsBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const buffer = bytes.buffer;
    const tensors = {};

    for (const descriptor of manifest.weights) {
      const elementCount = descriptor.shape.reduce((total, size) => total * size, 1);
      if (descriptor.dtype !== 'float32' || descriptor.byteLength !== elementCount * 4 ||
          descriptor.byteOffset < 0 || descriptor.byteOffset + descriptor.byteLength > buffer.byteLength) {
        Object.values(tensors).forEach(tensor => tensor.dispose());
        throw new Error(`模型张量 ${descriptor.name} 无效`);
      }
      const values = new Float32Array(buffer, descriptor.byteOffset, elementCount);
      tensors[descriptor.name] = tf.tensor(values, descriptor.shape, 'float32');
    }

    for (const name of ['W1', 'b1', 'W2', 'b2', 'W3', 'b3']) {
      if (!tensors[name]) {
        Object.values(tensors).forEach(tensor => tensor.dispose());
        throw new Error(`模型缺少张量 ${name}`);
      }
    }

    const model = new DigitModel(tensors);
    model.predict(new Float32Array(784));
    return model;
  }

  predict(pixels) {
    if (!(pixels instanceof Float32Array) || pixels.length !== 784) {
      throw new Error('模型输入必须是 784 个 float32 像素');
    }
    return tf.tidy(() => {
      const input = tf.tensor2d(pixels, [1, 784]);
      const hidden1 = tf.relu(tf.matMul(input, this.tensors.W1, false, true).add(this.tensors.b1));
      const hidden2 = tf.relu(tf.matMul(hidden1, this.tensors.W2, false, true).add(this.tensors.b2));
      const logits = tf.matMul(hidden2, this.tensors.W3, false, true).add(this.tensors.b3);
      return Array.from(tf.softmax(logits).dataSync());
    });
  }
}

function createCanvas(width, height) {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function preprocess(source) {
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  const { width, height } = source;
  const rgba = sourceContext.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4] <= 12) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      inkPixels++;
    }
  }
  if (inkPixels < 8) throw new Error('请先在画布上写一个数字');

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const scale = 20 / Math.max(cropWidth, cropHeight);
  const scaledWidth = Math.max(1, Math.round(cropWidth * scale));
  const scaledHeight = Math.max(1, Math.round(cropHeight * scale));
  const normalized = createCanvas(28, 28);
  const normalizedContext = normalized.getContext('2d', { willReadFrequently: true });
  normalizedContext.fillStyle = '#000';
  normalizedContext.fillRect(0, 0, 28, 28);
  normalizedContext.imageSmoothingEnabled = true;
  normalizedContext.imageSmoothingQuality = 'high';
  normalizedContext.drawImage(
    source,
    minX,
    minY,
    cropWidth,
    cropHeight,
    Math.floor((28 - scaledWidth) / 2),
    Math.floor((28 - scaledHeight) / 2),
    scaledWidth,
    scaledHeight,
  );

  const normalizedData = normalizedContext.getImageData(0, 0, 28, 28).data;
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < 28; y++) {
    for (let x = 0; x < 28; x++) {
      const value = normalizedData[(y * 28 + x) * 4];
      total += value;
      weightedX += value * x;
      weightedY += value * y;
    }
  }

  const offsetX = Math.round(13.5 - weightedX / total);
  const offsetY = Math.round(13.5 - weightedY / total);
  const centered = createCanvas(28, 28);
  const centeredContext = centered.getContext('2d', { willReadFrequently: true });
  centeredContext.fillStyle = '#000';
  centeredContext.fillRect(0, 0, 28, 28);
  centeredContext.drawImage(normalized, offsetX, offsetY);

  const centeredData = centeredContext.getImageData(0, 0, 28, 28).data;
  const pixels = new Float32Array(784);
  const preview = new Uint8ClampedArray(784);
  for (let index = 0; index < 784; index++) {
    preview[index] = centeredData[index * 4];
    pixels[index] = preview[index] / 255;
  }
  return { pixels, preview };
}

function pixelsToCanvas(target, pixels) {
  const targetContext = target.getContext('2d');
  const data = targetContext.createImageData(28, 28);
  pixels.forEach((value, index) => {
    data.data[index * 4] = value;
    data.data[index * 4 + 1] = value;
    data.data[index * 4 + 2] = value;
    data.data[index * 4 + 3] = 255;
  });
  targetContext.putImageData(data, 0, 0);
}

function renderProbabilities(probabilities, predictedDigit) {
  probabilityRows.forEach(({ row, bar, value, digit }) => {
    const probability = Number(probabilities?.[digit]);
    const valid = Number.isFinite(probability) && probability >= 0;
    const percent = valid ? probability * 100 : 0;
    bar.style.width = `${Math.min(percent, 100)}%`;
    value.textContent = valid ? `${percent.toFixed(2)}%` : '—';
    row.classList.toggle('is-prediction', digit === predictedDigit);
    row.setAttribute('aria-label', valid ? `数字 ${digit}，可信度 ${percent.toFixed(2)}%` : `数字 ${digit}，暂无结果`);
  });
}

function resetResult() {
  generation++;
  $('digit').textContent = '—';
  $('message').textContent = modelReady ? '写好后点击识别' : '正在加载浏览器模型…';
  $('preview').getContext('2d').clearRect(0, 0, 28, 28);
  renderProbabilities(null, null);
}

function updateControls() {
  $('clear').disabled = busy;
  $('predict').disabled = busy || !modelReady;
}

function clear() {
  if (busy) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 280, 280);
  dirty = false;
  drawing = false;
  $('hint').hidden = false;
  resetResult();
  $('message').textContent = modelReady ? '等待输入' : '正在加载浏览器模型…';
}

function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return [(event.clientX - bounds.left) * 280 / bounds.width, (event.clientY - bounds.top) * 280 / bounds.height];
}

canvas.addEventListener('pointerdown', event => {
  if (busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  dirty = true;
  $('hint').hidden = true;
  resetResult();
  const [x, y] = point(event);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 20;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y);
});

canvas.addEventListener('pointermove', event => {
  if (!drawing) return;
  ctx.lineTo(...point(event));
  ctx.stroke();
});

for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(eventName, () => { drawing = false; });
}

$('clear').addEventListener('click', clear);
$('predict').addEventListener('click', () => {
  if (!dirty) {
    $('message').textContent = '请先写一个数字';
    return;
  }
  if (busy || !modelReady) return;

  busy = true;
  drawing = false;
  resetResult();
  const version = generation;
  updateControls();
  $('message').textContent = '正在浏览器中识别…';

  try {
    const { pixels, preview } = preprocess(canvas);
    pixelsToCanvas($('preview'), preview);
    const startedAt = performance.now();
    const probabilities = digitModel.predict(pixels);
    const elapsed = performance.now() - startedAt;
    if (version !== generation) return;
    const digit = probabilities.indexOf(Math.max(...probabilities));
    $('digit').textContent = digit;
    $('message').textContent = `置信度 ${(probabilities[digit] * 100).toFixed(1)}% · ${tf.getBackend()} · ${elapsed.toFixed(1)} ms`;
    renderProbabilities(probabilities, digit);
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    busy = false;
    updateControls();
  }
});

clear();
updateControls();

DigitModel.load()
  .then(model => {
    digitModel = model;
    modelReady = true;
    document.documentElement.dataset.modelState = 'ready';
    $('message').textContent = dirty ? '写好后点击识别' : `模型已就绪 · ${tf.getBackend()}`;
  })
  .catch(error => {
    console.error(error);
    document.documentElement.dataset.modelState = 'error';
    $('message').textContent = `模型加载失败：${error.message}`;
  })
  .finally(updateControls);
