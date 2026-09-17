const $ = id => document.getElementById(id);
const canvas = $('drawing');
const context = canvas.getContext('2d', {willReadFrequently: true});
const fallbackAlphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
let alphabet = fallbackAlphabet;
let rows = [];
let modelLayers = [];
let modelReady = false;
let drawing = false;
let dirty = false;
let busy = false;
let generation = 0;
let recognizedCharacters = [];

function buildProbabilityRows() {
  $('probability-list').replaceChildren();
  rows = [...alphabet].map((character, classId) => {
    const row = document.createElement('div');
    const label = document.createElement('span');
    const track = document.createElement('div');
    const bar = document.createElement('div');
    const value = document.createElement('span');
    row.className = 'probability-row';
    label.className = 'probability-character';
    label.textContent = character;
    track.className = 'probability-track';
    bar.className = 'probability-bar';
    value.className = 'probability-value';
    value.textContent = '—';
    track.append(bar);
    row.append(label, track, value);
    $('probability-list').append(row);
    return {row, bar, value, character, classId};
  });
}

function renderProbabilities(probabilities, predictedClass) {
  rows.forEach(({row, bar, value, character, classId}) => {
    const probability = Number(probabilities?.[classId]);
    const valid = Number.isFinite(probability) && probability >= 0;
    const percent = valid ? probability * 100 : 0;
    bar.style.width = `${Math.min(percent, 100)}%`;
    value.textContent = valid ? `${percent.toFixed(percent >= 1 ? 2 : 3)}%` : '—';
    row.classList.toggle('is-prediction', classId === predictedClass);
    row.setAttribute('aria-label', valid ? `${character}，${percent.toFixed(2)}%` : `${character}，暂无结果`);
  });
}

function renderRecognizedCharacters() {
  const output = $('character');
  output.textContent = recognizedCharacters.length ? recognizedCharacters.join('') : '—';
  output.setAttribute(
    'aria-label',
    recognizedCharacters.length ? `累计识别结果：${recognizedCharacters.join('，')}` : '暂无识别结果',
  );
  output.scrollLeft = output.scrollWidth;
}

function resetLatestResult(message = '写好后点击识别') {
  generation += 1;
  $('message').textContent = message;
  $('preview').getContext('2d').clearRect(0, 0, 28, 28);
  renderProbabilities(null, null);
}

function clearDrawing() {
  context.fillStyle = '#000';
  context.fillRect(0, 0, 280, 280);
  dirty = false;
  drawing = false;
  $('hint').hidden = false;
}

function clear() {
  if (busy) return;
  clearDrawing();
  resetLatestResult(recognizedCharacters.length ? '可以继续写下一个字符' : '等待输入');
}

function clearResult() {
  if (busy) return;
  recognizedCharacters = [];
  renderRecognizedCharacters();
  clearPreviewHistory();
  $('message').textContent = dirty ? '当前输入尚未识别' : '等待输入';
}

function appendPreview(preview, character) {
  const item = document.createElement('div');
  item.className = 'preview-history-item';
  const image = document.createElement('canvas');
  image.width = 28;
  image.height = 28;
  image.setAttribute('aria-label', `${character} 的模型输入`);
  image.getContext('2d').drawImage(preview, 0, 0);
  const label = document.createElement('span');
  label.textContent = character;
  item.append(image, label);
  const history = $('preview-history');
  history.append(item);
  history.scrollTop = history.scrollHeight;
}

function clearPreviewHistory() {
  $('preview-history').replaceChildren();
}

function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return [
    (event.clientX - bounds.left) * 280 / bounds.width,
    (event.clientY - bounds.top) * 280 / bounds.height,
  ];
}

canvas.addEventListener('pointerdown', event => {
  if (busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  drawing = true;
  dirty = true;
  $('hint').hidden = true;
  resetLatestResult('输入已改变，写好后点击识别');
  const [x, y] = point(event);
  context.strokeStyle = '#fff';
  context.fillStyle = '#fff';
  context.lineWidth = 20;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.arc(x, y, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(x, y);
});
canvas.addEventListener('pointermove', event => {
  if (!drawing) return;
  context.lineTo(...point(event));
  context.stroke();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, () => { drawing = false; });
}

function setBusy(value) {
  busy = value;
  for (const button of document.querySelectorAll('button')) button.disabled = value;
  if (!value && !modelReady) $('predict').disabled = true;
}

function preprocessDrawing() {
  const source = context.getImageData(0, 0, 280, 280);
  let minX = 280;
  let minY = 280;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;
  for (let y = 0; y < 280; y += 1) {
    for (let x = 0; x < 280; x += 1) {
      if (source.data[(y * 280 + x) * 4] <= 12) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      inkPixels += 1;
    }
  }
  if (inkPixels < 8) throw new Error('请先在画布上写一个数字或字母');

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const scale = 20 / Math.max(cropWidth, cropHeight);
  const width = Math.max(1, Math.round(cropWidth * scale));
  const height = Math.max(1, Math.round(cropHeight * scale));
  const normalized = document.createElement('canvas');
  normalized.width = 28;
  normalized.height = 28;
  const normalizedContext = normalized.getContext('2d', {willReadFrequently: true});
  normalizedContext.imageSmoothingEnabled = true;
  normalizedContext.imageSmoothingQuality = 'high';
  normalizedContext.drawImage(
    canvas,
    minX, minY, cropWidth, cropHeight,
    Math.floor((28 - width) / 2), Math.floor((28 - height) / 2), width, height,
  );

  const normalizedData = normalizedContext.getImageData(0, 0, 28, 28).data;
  let ink = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < 28; y += 1) {
    for (let x = 0; x < 28; x += 1) {
      const value = normalizedData[(y * 28 + x) * 4];
      ink += value;
      weightedX += value * x;
      weightedY += value * y;
    }
  }
  const dx = Math.round(13.5 - weightedX / ink);
  const dy = Math.round(13.5 - weightedY / ink);
  const centered = document.createElement('canvas');
  centered.width = 28;
  centered.height = 28;
  const centeredContext = centered.getContext('2d', {willReadFrequently: true});
  centeredContext.drawImage(normalized, dx, dy);
  const centeredData = centeredContext.getImageData(0, 0, 28, 28).data;
  const pixels = new Float32Array(784);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = centeredData[index * 4] / 255;
  }
  return {pixels, preview: centered};
}

function runModel(pixels) {
  return tf.tidy(() => {
    let activation = tf.tensor2d(pixels, [1, 784]);
    modelLayers.forEach(({weight, bias}, index) => {
      activation = tf.matMul(activation, weight, false, true).add(bias);
      if (index < modelLayers.length - 1) {
        activation = activation.mul(tf.sigmoid(activation));
      }
    });
    return Array.from(tf.softmax(activation).dataSync());
  });
}

function updateModelProgress(loadedBytes, totalBytes, loadedShards = 0, totalShards = 0) {
  const percent = totalBytes > 0 ? Math.min(100, loadedBytes / totalBytes * 100) : 0;
  $('model-progress-bar').value = percent;
  $('model-progress-bar').textContent = `${percent.toFixed(0)}%`;
  $('model-progress-text').textContent = totalShards
    ? `${loadedShards}/${totalShards} · ${percent.toFixed(0)}%`
    : `${percent.toFixed(0)}%`;
}

function decodeBase64(value) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

async function predict() {
  if (!modelReady) {
    $('message').textContent = '静态模型尚未加载完成';
    return;
  }
  if (!dirty) {
    $('message').textContent = '请先写一个数字或字母';
    return;
  }
  if (busy) return;
  setBusy(true);
  drawing = false;
  resetLatestResult('正在浏览器中识别…');
  const version = generation;
  try {
    const {pixels, preview} = preprocessDrawing();
    const previewContext = $('preview').getContext('2d');
    previewContext.clearRect(0, 0, 28, 28);
    previewContext.drawImage(preview, 0, 0);
    const probabilities = runModel(pixels);
    if (version !== generation) return;
    const predictedClass = probabilities.indexOf(Math.max(...probabilities));
    const character = alphabet[predictedClass];
    recognizedCharacters.push(character);
    renderRecognizedCharacters();
    appendPreview(preview, character);
    $('message').textContent = `已加入 ${character} · 类别 ${predictedClass} · 置信度 ${(probabilities[predictedClass] * 100).toFixed(1)}% · 可继续写下一个字符`;
    renderProbabilities(probabilities, predictedClass);
    clearDrawing();
  } catch (error) {
    $('message').textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function loadModel() {
  buildProbabilityRows();
  try {
    if (!globalThis.tf) throw new Error('TensorFlow.js 加载失败');
    await tf.ready();
    $('model-state').textContent = '正在读取模型描述…';
    updateModelProgress(0, 0);
    const metadataResponse = await fetch('./model/model.json', {cache: 'no-cache'});
    if (!metadataResponse.ok) throw new Error(`模型描述加载失败：HTTP ${metadataResponse.status}`);
    const metadata = await metadataResponse.json();
    if (metadata.format !== 'azai-tfjs-dense-json-v1') throw new Error('不支持的静态模型格式');
    if (typeof metadata.alphabet !== 'string' || metadata.alphabet.length !== 62) {
      throw new Error('模型字符表无效');
    }
    if (!Array.isArray(metadata.shards) || !metadata.shards.length) {
      throw new Error('模型分片列表无效');
    }
    if (metadata.byte_count !== metadata.float_count * 4) {
      throw new Error('模型描述中的权重大小不一致');
    }

    const weightsBytes = new Uint8Array(metadata.byte_count);
    let loadedBytes = 0;
    updateModelProgress(0, metadata.byte_count, 0, metadata.shards.length);
    for (let index = 0; index < metadata.shards.length; index += 1) {
      const manifest = metadata.shards[index];
      $('model-state').textContent = `正在加载模型分片 ${index + 1}/${metadata.shards.length}…`;
      const response = await fetch(`./model/${manifest.file}`);
      if (!response.ok) throw new Error(`${manifest.file} 加载失败：HTTP ${response.status}`);
      const shard = await response.json();
      if (shard.format !== 'azai-tfjs-weight-shard-v1') {
        throw new Error(`${manifest.file} 格式无效`);
      }
      const bytes = decodeBase64(shard.data);
      if (
        shard.index !== index + 1
        || shard.count !== metadata.shards.length
        || shard.byte_offset !== manifest.byte_offset
        || bytes.byteLength !== manifest.byte_length
      ) {
        throw new Error(`${manifest.file} 内容与模型描述不一致`);
      }
      weightsBytes.set(bytes, manifest.byte_offset);
      loadedBytes += bytes.byteLength;
      updateModelProgress(
        loadedBytes,
        metadata.byte_count,
        index + 1,
        metadata.shards.length,
      );
    }
    if (loadedBytes !== metadata.byte_count) throw new Error('模型分片大小不完整');

    const values = new Float32Array(weightsBytes.buffer);
    modelLayers = metadata.layers.map(layer => ({
      weight: tf.tensor2d(
        values.subarray(layer.weight_offset, layer.weight_offset + layer.weight_length),
        [layer.output, layer.input],
      ),
      bias: tf.tensor1d(
        values.subarray(layer.bias_offset, layer.bias_offset + layer.bias_length),
      ),
    }));
    alphabet = metadata.alphabet;
    buildProbabilityRows();
    runModel(new Float32Array(784));
    modelReady = true;
    $('predict').disabled = false;
    $('model-state').textContent = `模型已就绪 · TensorFlow.js ${tf.version.tfjs} · ${tf.getBackend()}`;
    $('model-state').classList.add('is-ready');
    $('model-progress-text').textContent = `加载完成 · 100%`;
    $('dataset-summary').textContent = `${metadata.dataset} · ${metadata.architecture.join(' → ')} · 静态浏览器推理。`;
  } catch (error) {
    $('model-state').textContent = '静态模型加载失败';
    $('model-progress-text').textContent = '加载失败';
    $('dataset-summary').textContent = error.message;
    $('message').textContent = error.message;
  }
}

$('clear').addEventListener('click', clear);
$('clear-result').addEventListener('click', clearResult);
$('predict').addEventListener('click', predict);
clearDrawing();
renderRecognizedCharacters();
loadModel();
