import { buildApp } from "./app";

const { app, ctx } = await buildApp({ logger: true });
try {
  await app.listen({ port: ctx.cfg.port, host: ctx.cfg.host });
  const configured = ctx.registry.list().filter((p) => p.configured).map((p) => p.id);
  app.log.info(`Data directory: ${ctx.cfg.dataDir}`);
  app.log.info(`Configured providers: ${configured.length ? configured.join(", ") : "none (workflow design, prompts and Markdown export still work)"}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}
