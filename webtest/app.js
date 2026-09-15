'use strict';

const element = (id) => document.getElementById(id);
let model = null;

// tf.tidy 适合同步计算：不把 async 函数传给它。
function runTensorExample() {
  try {
    const result = tf.tidy(() => {
      const a = tf.tensor1d([1, 2, 3]);
      const b = tf.tensor1d([10, 20, 30]);
      const matrix = tf.tensor2d([[1, 2], [3, 4]]);
      const column = tf.tensor2d([[10], [20]]);
      // 返回普通 JS 数组，张量由 tidy 自动释放。
      return { sum: a.add(b).arraySync(), product: matrix.matMul(column).arraySync() };
    });
    element('tensor-output').textContent =
      `向量相加：[1, 2, 3] + [10, 20, 30] = ${JSON.stringify(result.sum)}\n` +
      `矩阵乘法：[[1, 2], [3, 4]] × [[10], [20]] = ${JSON.stringify(result.product)}`;
  } catch (error) {
    element('tensor-output').textContent = `计算失败：${error.message}`;
  }
}

async function trainModel() {
  element('bench-controls').disabled = true;
  element('train-button').disabled = true;
  element('predict-button').disabled = true;
  element('progress').value = 0;
  element('train-output').textContent = '正在训练…';
  element('predict-output').textContent = '训练完成后可以预测。';
  let xs, ys;
  try {
    if (model) model.dispose();
    model = tf.sequential();
    model.add(tf.layers.dense({
      units: 1,
      inputShape: [1],
      // 从零开始，便于观察这个简单线性模型的学习过程。
      kernelInitializer: 'zeros',
      biasInitializer: 'zeros',
    }));
    model.compile({ optimizer: tf.train.sgd(0.1), loss: 'meanSquaredError' });
    // 每行一个样本，每个样本一个特征，所以 shape 是 [5, 1]。
    xs = tf.tensor2d([-1, -0.5, 0, 0.5, 1], [5, 1]);
    ys = tf.tensor2d([-1, 0, 1, 2, 3], [5, 1]);
    await model.fit(xs, ys, {
      epochs: 100,
      batchSize: 5,
      shuffle: false,
      callbacks: {
        onEpochEnd: async (epoch, logs) => {
          element('progress').value = epoch + 1;
          element('train-output').textContent =
            `第 ${epoch + 1} / 100 轮 · 均方误差 loss = ${logs.loss.toFixed(8)}`;
          // 让浏览器有机会绘制进度并响应操作。
          await tf.nextFrame();
        },
      },
    });
    element('train-output').textContent += '\n训练完成！现在可以输入新的 x 进行预测。';
    element('predict-button').disabled = false;
    predict();
  } catch (error) {
    element('train-output').textContent = `训练失败：${error.message}`;
    if (model) { model.dispose(); model = null; }
  } finally {
    // fit 是异步操作，数据张量在训练结束后手动释放。
    if (xs) xs.dispose();
    if (ys) ys.dispose();
    element('train-button').disabled = false;
    element('bench-controls').disabled = false;
  }
}

function predict() {
  const input = element('prediction-input');
  const x = input.valueAsNumber;
  if (!Number.isFinite(x) || !input.checkValidity()) {
    element('predict-output').textContent = '请输入 -1000 到 1000 之间的有效数字。';
    return;
  }
  if (!model) return;
  try {
    const y = tf.tidy(() => {
      const inputTensor = tf.tensor2d([x], [1, 1]);
      return model.predict(inputTensor).dataSync()[0];
    });
    element('predict-output').textContent =
      `模型预测：${y.toFixed(4)}\n公式参考值：${2 * x + 1}\n绝对误差：${Math.abs(y - (2 * x + 1)).toFixed(6)}`;
  } catch (error) {
    element('predict-output').textContent = `预测失败：${error.message}`;
  }
}

async function initialize() {
  if (!window.tf) {
    element('status').textContent = 'TensorFlow.js 加载失败，请检查网络是否能访问 cdn.jsdelivr.net，然后刷新页面。';
    return;
  }
  try {
    await tf.ready();
    element('status').textContent = `已就绪 · TensorFlow.js ${tf.version.tfjs} · 计算后端：${tf.getBackend()}`;
    element('tensor-button').disabled = false;
    element('train-button').disabled = false;
  } catch (error) {
    element('status').textContent = `初始化失败：${error.message}`;
  }
}

element('tensor-button').addEventListener('click', runTensorExample);
element('train-button').addEventListener('click', trainModel);
element('predict-button').addEventListener('click', predict);
initialize();
