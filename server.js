import { createApp } from './src/app.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`紫微斗数排盘接口已启动: http://${HOST}:${PORT}`);
  console.log(`测试页: http://${HOST}:${PORT}/`);
  console.log(`健康检查: http://${HOST}:${PORT}/api/v1/health`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请换一个：PORT=8788 npm start`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n收到 ${signal}，关闭服务`);
    server.close(() => process.exit(0));
  });
}
