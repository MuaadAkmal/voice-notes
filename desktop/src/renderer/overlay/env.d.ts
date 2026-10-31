// Vite's `?url` import: the emitted asset's URL (used to load the AudioWorklet module).
declare module '*?url' {
  const url: string;
  export default url;
}
