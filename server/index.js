import { createApp } from './app.js';
const { app, close } = createApp({ databasePath: process.env.SAUNA_DATABASE, serveFrontend: true });
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Sauna Studio server: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { close(); process.exit(0); }));
