// 使用真实 TF.js CPU 后端验证计算和清理；DOM 替身仅模拟按钮与文本。
// node tests/benchmark.cjs <本地 tf.min.js 或 .cjs 路径>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tf = require(path.resolve(process.argv[2]));
const source = fs.readFileSync(path.join(__dirname, '../benchmark.js'), 'utf8');

async function page(library = tf, storage = new Map()) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      id, disabled: false, textContent: '', value: '', listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      removeAttribute(name) { delete this[name]; },
    });
    return nodes.get(id);
  };
  for (const id of ['bench-memory', 'bench-speed', 'bench-refresh', 'bench-stop', 'train-button', 'predict-button', 'tensor-button']) get(id);
  get('bench-backend').value = 'cpu';
  get('bench-cap').value = '16';
  get('bench-custom-cap').value = '4096';
  get('bench-size').value = '128';
  get('predict-button').disabled = true;
  get('bench-controls').disabled = true;
  vm.runInNewContext(source, {
    tf: library, window: { tf: library }, performance, navigator: {},
    document: { getElementById: get, querySelectorAll: () => [...nodes.values()] },
    setTimeout, console,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { get, click: (id) => get(id).listeners.click() };
}

(async () => {
  await tf.setBackend('cpu');
  await tf.ready();
  const p = await page();
  const before = tf.memory().numTensors;
  for (let i = 0; i < 2; i++) {
    await p.click('bench-memory');
    assert.match(p.get('bench-cpu').textContent, /≥ 16 MiB/);
    assert.match(p.get('bench-status').textContent, /达到所选上限/);
    assert.equal(tf.memory().numTensors, before);
  }
  await p.click('bench-speed');
  assert.match(p.get('bench-status').textContent, /测试完成/);
  assert.ok(parseFloat(p.get('bench-flops').textContent) > 0);
  assert.ok(parseFloat(p.get('bench-transfer').textContent) > 0);
  assert.equal(tf.memory().numTensors, before);
  assert.equal(p.get('predict-button').disabled, true);
  assert.equal(p.get('bench-stop').disabled, true);
  assert.match(p.get('bench-report').value, /浏览器 TensorFlow.js/);
  assert.match(p.get('bench-report').value, /不是服务器测试/);
  assert.match(p.get('bench-report').value, /GFLOP\/s/);
  assert.match(p.get('bench-report').value, /数据往返有效吞吐/);
  assert.match(p.get('bench-report').value, /测试 3：速度与算力/);
  assert.equal(p.get('bench-download').disabled, false);

  // Node 环境没有 WebGL；不可用时不能悄悄当作 CPU 测试成功。
  p.get('bench-backend').value = 'webgl';
  await p.click('bench-memory');
  assert.match(p.get('bench-status').textContent, /测试未完成/);
  assert.equal(tf.getBackend(), 'cpu');
  assert.equal(tf.memory().numTensors, before);
  p.get('bench-backend').value = 'cpu';

  p.get('bench-cap').value = 'unlimited';
  const running = p.click('bench-memory');
  setTimeout(() => p.click('bench-stop'), 5);
  await running;
  assert.match(p.get('bench-status').textContent, /用户停止/);
  assert.equal(tf.memory().numTensors, before);

  // 注入运算失败，确认 finally 释放此前成功保留的张量并恢复控件。
  let fills = 0;
  const faulty = new Proxy(tf, { get(target, key) {
    if (key === 'fill') return (...args) => {
      if (++fills === 2) throw new Error('模拟分配失败');
      return target.fill(...args);
    };
    return Reflect.get(target, key);
  } });
  const storage = new Map();
  const failed = await page(faulty, storage);
  failed.get('bench-cap').value = 'unlimited';
  await failed.click('bench-memory');
  assert.match(failed.get('bench-status').textContent, /模拟分配失败/);
  assert.match(failed.get('bench-cpu').textContent, /8 MiB（中断前）/);
  assert.equal(tf.memory().numTensors, before);
  assert.equal(failed.get('bench-memory').disabled, false);
  const restored = await page(tf, storage);
  assert.match(restored.get('bench-history').textContent, /8 MiB/);
  assert.match(restored.get('bench-history').textContent, /分配或校验失败/);
  assert.match(failed.get('bench-report').value, /持续探测，不设软件上限/);

  // 缩小底层分配，验证控制流程确实可跨越 1024 MiB；不冒充硬件容量实测。
  let blocks = 0;
  const scaled = new Proxy(tf, { get(target, key) {
    if (key === 'fill') return (shape, value) => { blocks++; return target.fill([8], value); };
    return Reflect.get(target, key);
  } });
  const large = await page(scaled);
  large.get('bench-cap').value = 'custom';
  large.get('bench-custom-cap').value = '1032';
  await large.click('bench-memory');
  assert.equal(blocks, 129);
  assert.match(large.get('bench-cpu').textContent, /≥ 1032 MiB/);
  assert.equal(tf.memory().numTensors, before);
  large.get('bench-custom-cap').value = '-1';
  await large.click('bench-memory');
  assert.match(large.get('bench-status').textContent, /正整数/);

  const missing = await page(null);
  assert.match(missing.get('bench-env').textContent, /CDN 未加载/);
  assert.equal(missing.get('bench-controls').disabled, true);
  console.log('PASS: real CPU computations; unlimited stop/failure; custom >1024 control flow (scaled allocations); invalid input; persistence; plain text reports; tensor cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
