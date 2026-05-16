import { bootstrapApp } from "../src/bootstrap.js";
import { createApp } from "../src/media-server.js";
let handlerPromise = null;
async function getHandler() {
    if (!handlerPromise) {
        handlerPromise = bootstrapApp().then(({ config, authManager, publisher, remoteService, storage }) => createApp(config, authManager, publisher, remoteService, storage));
    }
    return handlerPromise;
}
export default async function handler(req, res) {
    const app = await getHandler();
    return app(req, res);
}
