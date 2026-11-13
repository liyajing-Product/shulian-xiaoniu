# 数链小牛 · 公开体验版

纯前端的检索问答体验，不包含后台代码、公司知识文档、业务提示词、用户调用记录、数据库或站点密钥。

体验地址：https://liyajing-product.github.io/shulian-xiaoniu/

## 使用

1. 点击侧栏“API Key配置”，填写自己的**阿里云百炼中国内地（北京）Key**，需开通 `qwen-plus` 与 `text-embedding-v3`。
2. 验证两个模型会产生少量API用量；成功后可提问或切换知识检索。
3. 默认检索通用体验说明。可用“导入体验资料”临时选择自己的非敏感UTF-8 TXT/Markdown文件（最多200KB），相关片段会发送百炼。请勿导入内部公司资料或个人敏感信息。
4. Key及导入资料只保存在当前页面内存，刷新即清除，可手动清除。聊天与评价只保存在本浏览器，不汇总到后台；清除网站数据可删除本地记录。

## 数据流与边界

浏览器直接向 `https://dashscope.aliyuncs.com/compatible-mode/v1` 发起HTTPS请求，Key仅用于请求授权；GitHub Pages不接收或保存Key。调用费用由访客百炼账号承担。所有站点代码、通用示例及演示用提示词都是公开的，页面没有公司内部知识库，也不连接原项目管理后台。

检索使用text-embedding-v3向量与浏览器余弦相似度排序，回答使用qwen-plus流式生成。模型事实可能出错，输出不代表公司的正式答复。没有Key、验证失败、模型不可用或网络中断时显示明确错误，不提供虚构的成功结果。

本项目需要浏览器允许百炼跨域请求；已核实官方接口对本Pages来源的预检响应允许Authorization及Content-Type。网络或浏览器策略仍可能影响连接。

## 开发与发布

```sh
npm ci
npm run lint
npm test
npm run build
python3 -m http.server 18082 --directory dist
```

打开 http://127.0.0.1:18082/ 。推送main后GitHub Actions自动构建发布Pages。所有资源使用相对路径，适配项目子路径。不要把旧完整项目的.git、后端、PRD、知识目录或data目录复制到此仓库。

## 素材

导航图标保留IconPark许可证，见src/iconpark-LICENSE.txt；Qwen标识仅用于标注实际模型，见src/model-assets.md，不表示合作或背书。
