declare module "*.css";

declare module "*?worker" {
  const WorkerConstructor: { new (): Worker };
  export default WorkerConstructor;
}

// Injected by the Electron Forge Vite plugin; defined only under `electron-forge start`.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
