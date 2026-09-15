'use strict';

// 与教学示例共享 tf，但测试串行执行，期间禁用其他计算操作。
(() => {
  const $ = (id) => document.getElementById(id);
  const MiB = 1024 * 1024;
  let busy = false;
  let stop = false;
  const historyKey = 'tfjs-capacity-history-v1';
  let history = {};
  const sessionReports = [];
  function report(kind, backend, started) {
    // 只收集本次页面会话的实际运行日志，不将旧容量记录冒充当前测试。
    sessionReports.push([
      `测试 ${sessionReports.length + 1}：${kind === 'memory' ? '容量' : '速度与算力'} / ${backend}`,
      `开始时间：${started.toLocaleString()}；结束时间：${new Date().toLocaleString()}`,
      kind === 'memory'
        ? `容量设置：${$('bench-cap').value === 'unlimited' ? '持续探测，不设软件上限' : `${$('bench-cap').value === 'custom' ? $('bench-custom-cap').value : $('bench-cap').value} MiB`}；分块：8 MiB`
        : `矩阵设置：${$('bench-size').value} × ${$('bench-size').value}，float32 张量；预热 2 次，计划测量 7 次。`,
      `结束状态：${$('bench-status').textContent}`,
      $('bench-log').textContent.trim(),
    ].join('\n'));
    $('bench-report').value = [
      '浏览器 TensorFlow.js 容量与性能测试报告',
      '',
      '测试环境说明',
      '本报告来自网页内运行的 TensorFlow.js 测试。正式使用时，计算发生在访问者的浏览器与设备中，不是服务器测试，也不是原生硬件基准测试。',
      `TensorFlow.js 版本：${tf.version.tfjs}`,
      `浏览器标识（浏览器自报）：${navigator.userAgent || '未提供'}`,
      'CPU 指 TF.js JavaScript CPU 后端；WebGL 指浏览器图形后端，可能使用独立显卡、集成显卡或软件渲染。',
      '',
      '本页面会话的测试记录（按运行顺序，未执行的项目没有结果）',
      ...sessionReports.flatMap((entry) => [entry, '']),
      '资源快照（最后一次测试结束并恢复原后端后）',
      $('bench-env').textContent,
      '',
      '如何理解结果',
      '1. 容量为同时保留且逐块校验成功的 TF.js 逻辑张量字节下限；不是设备总内存、总显存、剩余显存或模型参数上限。MiB = 1048576 字节。',
      '2. 持续探测在分配或校验失败、用户停止时结束。失败可能来自浏览器、驱动或算子限制，不能直接认定为硬件容量极限。页面被系统关闭时无法生成最终报告；本机进度记录可能保留最近成功容量。',
      '3. 矩阵耗时包含运算与完整结果回读，预热 2 次后测量 7 次取中位数。有效 GFLOP/s = 2 × N³ / 耗时秒数 / 10⁹，不是显卡理论峰值，也不是模型 tokens/s。部分测试以实际完成次数为准。',
      '4. 数据往返测试为 4 MiB 输入加 4 MiB 输出，包含张量创建、加法及回读，预热 1 次后测量 5 次；不是纯 PCIe 或显存带宽。CPU 模式没有 GPU 传输。',
      '5. 实际模型还需要中间张量、输入输出和缓存空间。浏览器版本、后端精度、后台节流、温度及其他程序负载均可能影响结果。',
      '6. 本报告只包含本页面会话中主动运行的测试；未包含设备硬件总容量推测或历史缓存测试结果。',
    ].join('\n');
    $('bench-download').disabled = false;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) history = saved;
  } catch { /* 本地文件或隐私设置可能禁用存储，不影响测试。 */ }
  function showHistory() {
    const lines = ['cpu', 'webgl'].filter((backend) => Number.isFinite(history[backend]?.mib)).map((backend) => {
      const item = history[backend];
      return `${backend} 最近记录：${item.mib} MiB · ${item.time} · ${item.state === 'running' ? '运行中或异常中断（不是最大容量）' : item.state}`;
    });
    $('bench-history').textContent = lines.join('\n') || '暂无容量测试记录。';
  }
  function saveCapacity(backend, confirmed, state) {
    history[backend] = { mib: confirmed, state, time: new Date().toLocaleString() };
    showHistory();
    try { localStorage.setItem(historyKey, JSON.stringify(history)); }
    catch { $('bench-history').textContent += '\n浏览器不允许保存，刷新后无法恢复本次记录。'; }
  }
  // 循环使用小整数，防止持续探测时填充值增长导致低精度 WebGL 溢出。
  const blockValue = (index) => index % 16 + 1;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
  const mib = (bytes) => Number.isFinite(bytes) ? `${(bytes / MiB).toFixed(1)} MiB` : '未提供';
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  function log(message) {
    $('bench-log').textContent += `${message}\n`;
    $('bench-log').scrollTop = $('bench-log').scrollHeight;
  }
  function resources() {
    const memory = tf.memory();
    const heap = performance.memory;
    $('bench-env').textContent = [
      `TF.js ${tf.version.tfjs} · 当前后端 ${tf.getBackend()} · 逻辑处理器 ${navigator.hardwareConcurrency ?? '未提供'}`,
      `设备内存粗略档位：${navigator.deviceMemory ? `${navigator.deviceMemory} GiB（经浏览器取整/封顶，非可用量）` : '浏览器未提供'}`,
      `JS 堆已用 / 堆上限：${heap ? `${mib(heap.usedJSHeapSize)} / ${mib(heap.jsHeapSizeLimit)}（非页面总内存）` : '浏览器未提供'}`,
      `TF.js 活跃张量：${memory.numTensors} · 逻辑字节：${mib(memory.numBytes)} · GPU 活跃字节：${mib(memory.numBytesInGPU)}`,
      `总显存 / 剩余可用显存：浏览器不提供可靠查询。WebGL 也可能使用集成显卡或软件渲染。`,
      memory.unreliable ? `TF.js 内存统计仅供参考：${(memory.reasons || []).join('；')}` : 'TF.js 统计不包含浏览器、驱动和全部缓存开销。',
    ].join('\n');
  }
  async function verify(tensor, expected) {
    let check;
    try {
      // 校验均值，触发整个张量计算；仅回读标量，保留容量测试中的 GPU 数据。
      check = tf.tidy(() => tensor.mean());
      const value = (await check.data())[0];
      if (!Number.isFinite(value) || Math.abs(value - expected) > Math.max(0.01, Math.abs(expected) * 0.01)) {
        throw new Error(`数值校验失败：期望 ${expected}，实际 ${value}`);
      }
    } finally { check?.dispose(); }
  }
  async function capacity(backend) {
    const mode = $('bench-cap').value;
    const cap = mode === 'unlimited' ? Infinity : Number(mode === 'custom' ? $('bench-custom-cap').value : mode);
    if (cap !== Infinity && (!Number.isSafeInteger(cap) || cap <= 0)) {
      throw new Error('容量上限请输入正整数 MiB');
    }
    if (cap === Infinity) $('bench-progress').removeAttribute('value');
    const tensors = [];
    let confirmed = 0;
    let activeMs = 0;
    const result = $(`bench-${backend}`);
    result.textContent = '测试中…';
    saveCapacity(backend, 0, 'running');
    try {
      while (confirmed < cap && !stop) {
        const size = Math.min(8, cap - confirmed);
        const started = performance.now();
        // 每块独立分配；WebGL 的 add 强制执行着色器并生成后端纹理。
        const expected = blockValue(tensors.length) + 1;
        const tensor = tf.tidy(() => tf.fill([size * MiB / 4], expected - 1).add(1));
        tensors.push(tensor);
        await verify(tensor, expected);
        activeMs += performance.now() - started;
        confirmed += size;
        result.textContent = `≥ ${confirmed} MiB`;
        if (cap !== Infinity) $('bench-progress').value = confirmed / cap * 100;
        $('bench-status').textContent = `${backend}：同时保留并校验 ${confirmed} MiB${cap === Infinity ? '，持续探测中…' : ` / ${cap} MiB…`}`;
        saveCapacity(backend, confirmed, 'running');
        resources();
        await pause();
      }
      if (!stop) {
        // 在全部块同时存活时再次检查，避免只验证逐次分配。
        for (let i = 0; i < tensors.length && !stop; i++) {
          await verify(tensors[i], blockValue(i) + 1);
          await pause();
        }
      }
      const outcome = stop ? '用户停止（部分结果）' : '达到所选上限，未探测硬件极限';
      result.textContent = confirmed ? `≥ ${confirmed} MiB${stop ? '（部分）' : ''}` : '已停止，未验证';
      log(`${backend}：${outcome}；已逐块验证 ${confirmed} MiB。`);
      saveCapacity(backend, confirmed, outcome);
      if (confirmed) log(`分配 + 运算 + 首次校验吞吐：${(confirmed / (activeMs / 1000)).toFixed(1)} MiB/s（含首次编译，不是内存带宽）。`);
      return outcome;
    } catch (error) {
      result.textContent = `${confirmed} MiB（中断前）`;
      log(`失败前已验证 ${confirmed} MiB；失败不等于物理容量极限。`);
      saveCapacity(backend, confirmed, '分配或校验失败前的记录，非硬件极限');
      throw error;
    } finally {
      tf.dispose(tensors);
      if (cap === Infinity) $('bench-progress').value = 0;
    }
  }
  async function speed(backend) {
    const n = Number($('bench-size').value);
    const timings = [];
    let a, b;
    $('bench-latency').textContent = '测试中…';
    $('bench-flops').textContent = '测试中…';
    $('bench-transfer').textContent = '测试中…';
    $('bench-method').textContent = `${backend} · float32 张量 · ${n} × ${n} 矩阵 · 预热 2 次、正式 7 次，报告中位数。包含计算及完整结果回读，不代表硬件峰值或 tokens/s。`;
    try {
      a = tf.fill([n, n], 0.5);
      b = tf.fill([n, n], 0.25);
      for (let i = 0; i < 9 && !stop; i++) {
        $('bench-status').textContent = i < 2 ? `矩阵预热 ${i + 1}/2…` : `矩阵测量 ${i - 1}/7…`;
        let output;
        try {
          const started = performance.now();
          output = tf.matMul(a, b);
          const values = await output.data(); // 等待 GPU 完成，不能仅测 matMul() 返回时间。
          const elapsed = performance.now() - started;
          const expected = n / 8;
          if (!values.every((value) => Number.isFinite(value) && Math.abs(value - expected) < 0.01)) {
            throw new Error('矩阵结果校验失败');
          }
          if (i >= 2) timings.push(elapsed);
        } finally { output?.dispose(); }
        $('bench-progress').value = (i + 1) / 15 * 100;
        await pause();
      }
      if (timings.length) {
        const ms = median(timings);
        $('bench-latency').textContent = `${ms.toFixed(2)} ms`;
        $('bench-flops').textContent = `${(2 * n ** 3 / (ms / 1000) / 1e9).toFixed(2)} GFLOP/s`;
        log(`有效矩阵算力：${$('bench-flops').textContent}（含结果回读）。`);
        log(`${backend} matMul ${n}²：${timings.map((ms) => ms.toFixed(2)).join(', ')} ms；${timings.length}/7 次。`);
        log(`中位数 ${ms.toFixed(2)} ms；约 ${(1000 / ms).toFixed(1)} 次矩阵乘法/秒。GFLOP/s = 2 × N³ / 秒 / 10⁹。`);
      } else {
        $('bench-latency').textContent = '未完成';
        $('bench-flops').textContent = '未完成';
      }
      if (stop) { $('bench-transfer').textContent = '未测试'; return '用户停止（部分结果）'; }
      // 每轮新建输入，避免 data() 缓存让传输测试退化成读取 CPU 缓存。
      const source = new Float32Array(MiB).fill(0.5); // 4 MiB 输入 + 4 MiB 输出。
      const transfers = [];
      for (let i = 0; i < 6 && !stop; i++) {
        let output;
        try {
          const started = performance.now();
          output = tf.tidy(() => tf.tensor1d(source).add(1));
          const values = await output.data();
          const elapsed = performance.now() - started;
          if (!values.every((value) => value === 1.5)) throw new Error('数据往返校验失败');
          if (i > 0) transfers.push(elapsed);
        } finally { output?.dispose(); }
        $('bench-status').textContent = `数据往返 ${i + 1}/6（第 1 次预热）…`;
        $('bench-progress').value = (10 + i) / 15 * 100;
        await pause();
      }
      if (transfers.length) {
        const ms = median(transfers);
        $('bench-transfer').textContent = `${(8 / (ms / 1000)).toFixed(1)} MiB/s`;
        log(`数据往返有效吞吐：${$('bench-transfer').textContent}。`);
        log(`4 MiB 输入 + 4 MiB 输出，${transfers.length}/5 次，中位耗时 ${ms.toFixed(2)} ms。包含张量创建、加法、回读；不是纯 PCIe/显存带宽。CPU 模式无 GPU 传输。`);
      } else $('bench-transfer').textContent = '未完成';
      return stop ? '用户停止（部分结果）' : '速度与算力测试完成';
    } catch (error) {
      for (const id of ['bench-latency', 'bench-flops', 'bench-transfer']) {
        if ($(id).textContent === '测试中…') $(id).textContent = '未完成';
      }
      throw error;
    } finally { a?.dispose(); b?.dispose(); }
  }
  async function run(kind) {
    if (busy) return;
    busy = true;
    stop = false;
    const started = new Date();
    const backend = $('bench-backend').value;
    const previousBackend = tf.getBackend();
    const controls = [...document.querySelectorAll('button, input, select')].filter((node) => node.id !== 'bench-stop');
    const states = controls.map((node) => node.disabled);
    controls.forEach((node) => { node.disabled = true; });
    $('bench-stop').disabled = false;
    $('bench-progress').value = 0;
    $('bench-log').textContent = `${new Date().toLocaleString()} · ${backend} · ${kind === 'memory' ? '容量' : '性能'}测试\n`;
    $('bench-status').textContent = `正在初始化 ${backend}…`;
    try {
      if (!await tf.setBackend(backend)) throw new Error(`${backend} 后端不可用，请改选其他后端`);
      await tf.ready();
      resources();
      const before = tf.memory().numTensors;
      let outcome;
      try { outcome = kind === 'memory' ? await capacity(backend) : await speed(backend); }
      finally { log(`测试张量已释放；活跃张量：测试前 ${before}，测试后 ${tf.memory().numTensors}。`); }
      $('bench-status').textContent = `${backend}：${outcome}。`;
    } catch (error) {
      $('bench-status').textContent = `${backend} 测试未完成：${error.message}。若 WebGL 上下文丢失，请刷新页面。`;
      log(`错误：${error.message}`);
    } finally {
      try {
        if (!await tf.setBackend(previousBackend)) throw new Error('无法恢复原后端');
        resources();
      } catch (error) { log(`恢复提示：${error.message}；请刷新页面。`); }
      controls.forEach((node, index) => { node.disabled = states[index]; });
      $('bench-stop').disabled = true;
      busy = false;
      report(kind, backend, started);
    }
  }
  $('bench-memory').addEventListener('click', () => run('memory'));
  showHistory();
  $('bench-download').addEventListener('click', () => {
    const blob = new Blob([$('bench-report').value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tfjs-browser-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('bench-speed').addEventListener('click', () => run('speed'));
  $('bench-refresh').addEventListener('click', resources);
  $('bench-stop').addEventListener('click', () => {
    stop = true;
    $('bench-stop').disabled = true;
    $('bench-status').textContent = '已请求停止，等待当前计算完成并释放张量…';
  });
  if (window.tf) tf.ready().then(() => {
    resources();
    $('bench-controls').disabled = false;
    if (tf.getBackend() === 'cpu') $('bench-backend').value = 'cpu';
  }).catch((error) => { $('bench-env').textContent = `TF.js 初始化失败：${error.message}`; });
  else $('bench-env').textContent = 'TF.js CDN 未加载，测试不可用。请检查网络后刷新。';
})();
