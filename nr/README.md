# Digit Lab · 独立 TF.js 静态版

这是原 Python 版之外的一套独立网页。预处理和推理全部在浏览器完成，不调用 `/api/predict`，也不会修改或依赖原来的 `backend-web/`、`server.py` 和 `model.py`。

直接双击 `index.html` 即可使用。发布时将整个 `tfjs-web/` 文件夹上传到任意静态托管即可，无需构建、Node、Python 或网络连接。

文件说明：

- `index.html`：页面入口；
- `app.js`：Canvas 预处理与 TensorFlow.js 推理；
- `model-data.js`：由现有 `digit_model.pt` 导出的内嵌权重；
- `vendor/tf.min.js`：本地 TensorFlow.js 4.22.0；
- `style.css`：沿用原页面样式。

原模型重新训练后，在项目根目录运行以下命令即可更新静态版权重：

```powershell
node export_tfjs_model.mjs
```
