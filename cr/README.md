# 纯静态 TensorFlow.js 版本

必须完整部署 `backend-web` 整个目录，不能只更新 `model` 子目录。网页只读取本目录中的 HTML、CSS、JavaScript、
`model/model.json` 和多个不超过 100 KB 的 `model/weights-*.json`，识别计算全部在浏览器中完成。

本地预览时，在 `backend-web` 目录启动任意静态文件服务器，例如：

```powershell
python -m http.server 8080
```

然后访问 `http://127.0.0.1:8080/`。这个进程只负责提供静态文件，不参与模型推理。

训练产生新的 `digit_model.pt` 后，在项目目录重新导出网页权重：

```powershell
python export_tfjs.py
```

TensorFlow.js 已保存在 `vendor/tf.min.js`，部署后不依赖 CDN。
