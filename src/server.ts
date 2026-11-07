import { createApp } from './app';
import { config } from './config';

const app = createApp();

app.listen(config.port, () => {
  console.log(`Smart Fishing Morocco backend listening on port ${config.port} [${config.nodeEnv}]`);
});
